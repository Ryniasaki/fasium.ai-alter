"use client"

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { BoardBroadcastModal } from "./components/BoardBroadcastModal"
import { RecordView } from "./components/RecordView"
import { ProjectCanvas } from "./components/ProjectCanvas"
import type { CanvasAsset, DrawingPath, RepositoryTask, Task } from "./types"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { redesignApiClient } from "@/lib/redesign-api-client"
import {
  buildBoardBroadcastVersion,
  readDismissedBroadcastVersions,
  type BoardBroadcast,
  writeDismissedBroadcastVersions,
} from "@/lib/board-broadcasts"
import {
  buildBoardCoverCacheStorageKey,
  readBoardCoverCache,
  purgeLegacyBoardCoverCache,
  resolveCachedBoardCoverSrc,
  type BoardCoverCache,
  writeBoardCoverCache,
} from "@/lib/board-cover-cache"
import type { TaskHistoryItem } from "@/lib/redesign-api-client"

type ProjectSummary = {
  project_id: string
  user_id: string
  project_content?: {
    name?: string
    description?: string
    protected?: boolean
    task_ids?: string[]
    board?: {
      version?: number
      canvasAssets?: CanvasAsset[]
      drawings?: DrawingPath[]
      viewState?: {
        offsetX?: number
        offsetY?: number
        scale?: number
      }
      updatedAt?: string
    }
  }
  created_at?: string
  updated_at?: string
}

type ProjectWithAccess = ProjectSummary & {
  accessRole?: "owner" | "shared"
  permission?: string
}

type PaginatedProjectsResponse = {
  projects?: ProjectSummary[]
  page?: number
  page_size?: number
  total?: number
  total_pages?: number
}

type BoardState = {
  canvasAssets: CanvasAsset[]
  drawings: DrawingPath[]
  viewState: {
    offsetX: number
    offsetY: number
    scale: number
  }
}

const PROJECTS_PAGE_SIZE = 9

const getProjectSortTimestamp = (project: ProjectWithAccess): number => {
  const updatedAt = Date.parse(project.updated_at || "")
  if (Number.isFinite(updatedAt)) {
    return updatedAt
  }
  const createdAt = Date.parse(project.created_at || "")
  if (Number.isFinite(createdAt)) {
    return createdAt
  }
  return -1
}

const sortProjects = (items: ProjectWithAccess[]): ProjectWithAccess[] => {
  return [...items].sort((a, b) => {
    const timeDiff = getProjectSortTimestamp(b) - getProjectSortTimestamp(a)
    if (timeDiff !== 0) {
      return timeDiff
    }
    const createdDiff = Date.parse(b.created_at || "") - Date.parse(a.created_at || "")
    if (Number.isFinite(createdDiff) && createdDiff !== 0) {
      return createdDiff
    }
    return a.project_id.localeCompare(b.project_id)
  })
}

const createNewProjectBoardTemplate = (
  name: string,
  viewState: BoardState["viewState"],
) => ({
  version: 1,
  canvasAssets: [],
  drawings: [],
  viewState,
  updatedAt: new Date().toISOString(),
  name,
})

const formatProjectDate = (value: string | null | undefined, locale: "en" | "zh") => {
  const localeCode = locale === "zh" ? "zh-CN" : "en-US"
  if (!value) {
    return new Date().toLocaleDateString(localeCode, { year: "numeric", month: "long", day: "numeric" })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(localeCode, { year: "numeric", month: "long", day: "numeric" })
}

const getProjectDisplayName = (
  project: ProjectSummary | ProjectWithAccess | null | undefined,
  locale: "en" | "zh",
) => {
  const name = project?.project_content?.name
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim()
  }
  return project?.project_id ?? (locale === "zh" ? "未命名项目" : "Untitled Project")
}

const normalizeBoardState = (raw: ProjectSummary["project_content"] | null | undefined): BoardState | null => {
  const board = raw?.board
  if (!board || typeof board !== "object") {
    return null
  }
  const viewState = board.viewState
  const scale = typeof viewState?.scale === "number" ? viewState.scale : 1
  return {
    canvasAssets: Array.isArray(board.canvasAssets) ? board.canvasAssets : [],
    drawings: Array.isArray(board.drawings) ? board.drawings : [],
    viewState: {
      offsetX: typeof viewState?.offsetX === "number" ? viewState.offsetX : 0,
      offsetY: typeof viewState?.offsetY === "number" ? viewState.offsetY : 0,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    },
  }
}

const getBoardTaskTitle = (taskType: string | null | undefined, taskId: string, locale: "en" | "zh") => {
  switch (taskType) {
    case "targeted_redesign":
      return locale === "zh" ? "以图生款" : "Image-to-Design"
    case "seamless_pattern":
      return locale === "zh" ? "无缝花型" : "Seamless Pattern"
    case "stripe_pattern":
      return locale === "zh" ? "条纹图案" : "Stripe Pattern"
    case "super_resolution":
      return locale === "zh" ? "高清增强" : "Super Resolution"
    case "svg_vectorization":
      return locale === "zh" ? "矢量化" : "Vectorization"
    case "text_to_image":
      return locale === "zh" ? "以文生款" : "Text-to-Image"
    default:
      return taskType ? `${taskType}` : taskId || (locale === "zh" ? "任务" : "Task")
  }
}

const hasPendingUploadAssets = (state: BoardState): boolean => {
  return state.canvasAssets.some(
    (asset) => asset.type === "image" && asset.status === "loading" && !asset.tenantTaskId,
  )
}

const getPendingGenerationTaskIds = (state: BoardState): string[] => {
  return Array.from(
    new Set(
      state.canvasAssets
        .filter(
          (asset) =>
            asset.type === "image" &&
            asset.status === "loading" &&
            Boolean(asset.tenantTaskId) &&
            asset.tenantTaskStatus !== "FAILED" &&
            asset.tenantTaskStatus !== "ERROR",
        )
        .map((asset) => asset.tenantTaskId)
        .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
    ),
  )
}

type StorageEntry =
  | string
  | {
      original?: string | null
      thumbnail?: string | null
      localPath?: string | null
      path?: string | null
    }

const normalizeToStaticImageUrl = (path: string | null | undefined): string | null => {
  if (!path || typeof path !== "string") {
    return null
  }
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  if (path.startsWith("/api/proxy/static/images/") || path.startsWith("/proxy/static/images/") || path.startsWith("/static/images/")) {
    const prefixes = ["/api/proxy/static/images/", "/proxy/static/images/", "/static/images/"]
    for (const prefix of prefixes) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length).replace(/^\/+/, "")
      if (/^https?:\/\//i.test(rest)) {
        return rest
      }
      break
    }
    return path
  }
  let normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "")
  normalized = normalized.replace(/^output\//i, "")
  if (!normalized) {
    return null
  }
  return `/api/proxy/static/images/${normalized}`
}

const getTaskPreviewUrls = (task: TaskHistoryItem): string[] => {
  const prefersVectorPreview = task.task_type === "svg_vectorization"
  if (prefersVectorPreview && Array.isArray(task.image_urls) && task.image_urls.length > 0) {
    const svgImages = task.image_urls.filter(
      (url): url is string => typeof url === "string" && url.toLowerCase().includes(".svg"),
    )
    if (svgImages.length > 0) {
      return svgImages.slice(0, 1)
    }
  }
  if (Array.isArray(task.thumbnail_urls) && task.thumbnail_urls.length > 0) {
    if (prefersVectorPreview) {
      const vectorThumbs = task.thumbnail_urls.filter(isWebpOrSvgUrl)
      return vectorThumbs.length > 0 ? vectorThumbs.slice(0, 1) : []
    }
    const webpThumbs = task.thumbnail_urls.filter(isWebpUrl)
    return webpThumbs.length > 0 ? webpThumbs.slice(0, 1) : []
  }
  if (Array.isArray(task.image_urls) && task.image_urls.length > 0) {
    if (prefersVectorPreview) {
      const vectorImages = task.image_urls.filter(isWebpOrSvgUrl)
      return vectorImages.length > 0 ? vectorImages.slice(0, 1) : []
    }
    const webpImages = task.image_urls.filter(isWebpUrl)
    return webpImages.length > 0 ? webpImages.slice(0, 1) : []
  }
  if (!Array.isArray(task.storage_paths) || task.storage_paths.length === 0) {
    return []
  }
  const urls: string[] = []
  for (const entry of task.storage_paths as StorageEntry[]) {
    if (typeof entry === "string") {
      const normalized = normalizeToStaticImageUrl(entry)
      if (prefersVectorPreview && normalized && normalized.toLowerCase().includes(".svg")) {
        urls.push(normalized)
        break
      }
      const preview = buildPreviewUrl(normalized)
      if (isWebpUrl(preview)) {
        urls.push(preview)
      }
      continue
    }
    if (entry && typeof entry === "object") {
      const normalized = normalizeToStaticImageUrl(entry.thumbnail ?? entry.original ?? entry.localPath ?? entry.path)
      if (prefersVectorPreview && normalized && normalized.toLowerCase().includes(".svg")) {
        urls.push(normalized)
        break
      }
      const preview = buildPreviewUrl(normalized)
      if (isWebpUrl(preview)) {
        urls.push(preview)
      }
    }
  }
  return urls.slice(0, 1)
}

const getTaskOriginalUrls = (task: TaskHistoryItem): string[] => {
  if (Array.isArray(task.image_urls) && task.image_urls.length > 0) {
    return task.image_urls.filter((url): url is string => typeof url === "string" && url.length > 0)
  }
  if (!Array.isArray(task.storage_paths) || task.storage_paths.length === 0) {
    return Array.isArray(task.thumbnail_urls) ? task.thumbnail_urls.filter((url): url is string => typeof url === "string" && url.length > 0) : []
  }
  const urls: string[] = []
  for (const entry of task.storage_paths as StorageEntry[]) {
    if (typeof entry === "string") {
      const normalized = normalizeToStaticImageUrl(entry)
      if (normalized) {
        urls.push(normalized)
      }
      continue
    }
    if (entry && typeof entry === "object") {
      const normalized = normalizeToStaticImageUrl(entry.original ?? entry.localPath ?? entry.path ?? entry.thumbnail)
      if (normalized) {
        urls.push(normalized)
      }
    }
  }
  return urls
}

const buildPreviewUrl = (rawUrl: string | null | undefined): string | null => {
  if (!rawUrl || typeof rawUrl !== "string") return null
  if (rawUrl.startsWith("data:")) return rawUrl
  if (rawUrl.includes("image/svg+xml") || rawUrl.toLowerCase().endsWith(".svg")) return rawUrl

  const prefixes = ["/api/proxy/static/images/", "/proxy/static/images/"]
  const matchPrefix = prefixes.find((prefix) => rawUrl.includes(prefix))
  if (!matchPrefix) return null
  const prefixIndex = rawUrl.indexOf(matchPrefix)
  const base = rawUrl.slice(0, prefixIndex)
  const rest = rawUrl.slice(prefixIndex + matchPrefix.length)
  const pathPart = rest.split(/[?#]/)[0]
  if (!pathPart) return null
  const segments = pathPart.split("/").filter(Boolean)
  if (segments.length === 0) return null
  const filename = segments.pop() as string
  const stem = filename.replace(/\.[^.]+$/, "")
  if (!stem) return null
  const dir = segments.join("/")
  const hasThumbnailDir = segments[segments.length - 1] === "thumbnail"
  const previewRelative = dir
    ? hasThumbnailDir
      ? `${dir}/${stem}.webp`
      : `${dir}/thumbnail/${stem}.webp`
    : `thumbnail/${stem}.webp`
  const suffix = rest.slice(pathPart.length)
  return `${base}${matchPrefix}${previewRelative}${suffix}`
}

const isWebpUrl = (url: string | null | undefined): url is string => {
  if (!url || typeof url !== "string") return false
  const lower = url.toLowerCase()
  return lower.includes("image/webp") || lower.endsWith(".webp") || lower.includes(".webp?")
}

const isWebpOrSvgUrl = (url: string | null | undefined): url is string => {
  if (isWebpUrl(url)) {
    return true
  }
  return typeof url === "string" && url.toLowerCase().includes(".svg")
}

const getAssetPreviewUrl = (asset: CanvasAsset): string | null => {
  if (isWebpUrl(asset.previewUrl)) return asset.previewUrl
  const built = buildPreviewUrl(asset.url)
  return isWebpUrl(built) ? built : null
}

const resolveAssetImageUrl = (asset: CanvasAsset): string | null => {
  const candidates = [
    asset.previewUrl,
    buildPreviewUrl(asset.url),
    normalizeToStaticImageUrl(asset.url),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }
  return null
}

const getLatestProjectPreviewImages = (assets: CanvasAsset[] | null | undefined): string[] => {
  if (!Array.isArray(assets) || assets.length === 0) {
    return []
  }
  const ranked = assets
    .map((asset, index) => {
      const createdAtValue = asset.createdAt ? Date.parse(asset.createdAt) : Number.NaN
      const createdAt = Number.isFinite(createdAtValue) ? createdAtValue : -1
      return {
        asset,
        index,
        createdAt,
      }
    })
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return b.createdAt - a.createdAt
      }
      return b.index - a.index
    })

  for (const item of ranked) {
    if (item.asset.type !== "image") {
      continue
    }
    const preview = resolveAssetImageUrl(item.asset)
    if (preview) {
      return [preview]
    }
  }
  return []
}

const buildAuthHeaders = (token: string | null, extra: Record<string, string> = {}) => {
  if (!token || token === "__cookie__") {
    return extra
  }
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type BoardNavigationRequestDetail = {
  targetUrl?: string
}

type BoardNavigationGuard = (targetUrl: string) => boolean | Promise<boolean>

export default function BoardPage() {
  const { token, user, isLoading } = useAuth()
  const { messages, locale } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const copy = messages.project
  const boardCopy = messages.board
  const isManager = user?.role === "manager" && user?.group !== 1000
  const boardCoverStorageKey = useMemo(
    () => buildBoardCoverCacheStorageKey(user?.id ?? user?.username ?? null),
    [user?.id, user?.username],
  )
  const [projects, setProjects] = useState<ProjectWithAccess[]>([])
  const [projectPage, setProjectPage] = useState(1)
  const [projectTotal, setProjectTotal] = useState(0)
  const [projectTotalPages, setProjectTotalPages] = useState(1)
  const [isProjectsLoading, setIsProjectsLoading] = useState(true)
  const [boardStates, setBoardStates] = useState<Record<string, BoardState>>({})
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const boardStatesRef = useRef<Record<string, BoardState>>({})
  const boardLoadedRef = useRef<Record<string, boolean>>({})
  const boardGenerationPollInFlightRef = useRef(false)
  const [repositoryTasks, setRepositoryTasks] = useState<RepositoryTask[]>([])
  const [latestTaskPreviewByProject, setLatestTaskPreviewByProject] = useState<Record<string, string>>({})
  const [boardCoverCache, setBoardCoverCache] = useState<BoardCoverCache>({})
  const boardCoverCacheRef = useRef<BoardCoverCache>({})
  const boardCoverCacheLoadedKeyRef = useRef<string | null>(null)
  const boardCoverCachePurgeDoneRef = useRef(false)
  const [boardCoverCacheReady, setBoardCoverCacheReady] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isLeavingBoard, setIsLeavingBoard] = useState(false)
  const lastSyncedRef = useRef<Record<string, string>>({})
  const dirtyProjectsRef = useRef<Set<string>>(new Set())
  const pendingSyncCountRef = useRef(0)
  const tasksLoadPromiseRef = useRef<Promise<void> | null>(null)
  const detailRequestsRef = useRef<Record<string, Promise<void> | null>>({})
  const [activeBroadcasts, setActiveBroadcasts] = useState<BoardBroadcast[]>([])
  const [visibleBroadcasts, setVisibleBroadcasts] = useState<BoardBroadcast[]>([])
  const [broadcastModalBroadcasts, setBroadcastModalBroadcasts] = useState<BoardBroadcast[]>([])
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false)
  const [broadcastModalIndex, setBroadcastModalIndex] = useState(0)
  const [leavePromptUrl, setLeavePromptUrl] = useState<string | null>(null)
  const [leavePromptSaving, setLeavePromptSaving] = useState(false)
  const [leavePromptError, setLeavePromptError] = useState<string | null>(null)
  const lastBoardUrlRef = useRef("/board")

  useEffect(() => {
    if (isLoading) return
    if (token || user) return
    router.replace("/")
  }, [isLoading, router, token, user])

  const hydrateBoardState = useCallback((
    projectId: string,
    projectContent?: ProjectSummary["project_content"],
    options?: { force?: boolean },
  ) => {
    setBoardStates((previous) => {
      if (previous[projectId] && !options?.force) {
        return previous
      }
      const serverState = normalizeBoardState(projectContent)
      const state =
        serverState ?? {
          canvasAssets: [],
          drawings: [],
          viewState: { offsetX: 0, offsetY: 0, scale: 1 },
        }
      if (!lastSyncedRef.current[projectId] || options?.force) {
        lastSyncedRef.current[projectId] = JSON.stringify(state)
      }
      boardLoadedRef.current[projectId] = Boolean(projectContent && typeof projectContent === "object" && "board" in projectContent)
      dirtyProjectsRef.current.delete(projectId)
      return { ...previous, [projectId]: state }
    })
  }, [])

  const fetchProjects = useCallback(async () => {
    if (!token) {
      setProjects([])
      setProjectTotal(0)
      setProjectTotalPages(1)
      setIsProjectsLoading(false)
      return
    }

    try {
      const response = await fetch(
        `/api/proxy/projects?include_board=false&include_shared=true&page=${projectPage}&page_size=${PROJECTS_PAGE_SIZE}`,
        {
          method: "GET",
          headers: buildAuthHeaders(token),
          cache: "no-store",
        },
      )

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.loadProjects)
      }

      const rawProjects = Array.isArray((data as PaginatedProjectsResponse | null)?.projects)
        ? (((data as PaginatedProjectsResponse).projects ?? []) as ProjectSummary[])
        : []
      const nextTotal = Math.max(0, Number((data as PaginatedProjectsResponse | null)?.total ?? 0))
      const nextTotalPages = Math.max(1, Number((data as PaginatedProjectsResponse | null)?.total_pages ?? 1))
      const nextPage = Math.max(1, Number((data as PaginatedProjectsResponse | null)?.page ?? projectPage))

      setProjectTotal(nextTotal)
      setProjectTotalPages(nextTotalPages)

      if (nextPage > nextTotalPages) {
        setProjectPage(nextTotalPages)
        return
      }

      const list = sortProjects(
        rawProjects.map((project) => ({
          ...project,
          accessRole: project.user_id === user?.username ? "owner" : "shared",
        })),
      )
      setProjects(list)
      list.forEach((project) => hydrateBoardState(project.project_id, project.project_content))
    } catch (error) {
      console.error("Failed to load projects:", error)
    } finally {
      setIsProjectsLoading(false)
    }
  }, [copy.errors.loadProjects, hydrateBoardState, projectPage, token, user?.username])

  useEffect(() => {
    setIsProjectsLoading(true)
    void fetchProjects()
  }, [fetchProjects])

  const refreshVisibleBroadcasts = useCallback((items: BoardBroadcast[]) => {
    const dismissed = readDismissedBroadcastVersions()
    const nextVisible = items.filter((item) => dismissed[String(item.id)] !== buildBoardBroadcastVersion(item))
    setVisibleBroadcasts(nextVisible)
    return nextVisible
  }, [])

  const fetchActiveBroadcasts = useCallback(async () => {
    if (!token) {
      setActiveBroadcasts([])
      setVisibleBroadcasts([])
      setIsBroadcastModalOpen(false)
      return
    }
    try {
      const response = await fetch("/api/proxy/broadcasts/active", {
        headers: buildAuthHeaders(token),
        cache: "no-store",
      })
      const data = (await response.json().catch(() => ({}))) as { items?: BoardBroadcast[] }
      if (!response.ok) {
        throw new Error("Failed to load active broadcasts")
      }
      const items = Array.isArray(data.items) ? data.items : []
      setActiveBroadcasts(items)
      const nextVisible = refreshVisibleBroadcasts(items)
      if (nextVisible.length > 0) {
        setBroadcastModalBroadcasts(nextVisible)
        setBroadcastModalIndex(0)
        setIsBroadcastModalOpen(true)
      } else {
        setIsBroadcastModalOpen(false)
      }
    } catch (error) {
      console.error("Failed to load board broadcasts:", error)
    }
  }, [refreshVisibleBroadcasts, token])

  const commitBoardCoverCache = useCallback(
    (nextCache: BoardCoverCache) => {
      boardCoverCacheLoadedKeyRef.current = boardCoverStorageKey
      boardCoverCacheRef.current = nextCache
      setBoardCoverCache(nextCache)
      writeBoardCoverCache(boardCoverStorageKey, nextCache)
    },
    [boardCoverStorageKey],
  )

  useEffect(() => {
    void fetchActiveBroadcasts()
  }, [fetchActiveBroadcasts])

  useEffect(() => {
    boardStatesRef.current = boardStates
  }, [boardStates])

  useEffect(() => {
    boardCoverCacheRef.current = boardCoverCache
  }, [boardCoverCache])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!boardCoverCachePurgeDoneRef.current) {
      purgeLegacyBoardCoverCache()
      boardCoverCachePurgeDoneRef.current = true
    }

    const nextCache = readBoardCoverCache(boardCoverStorageKey)
    boardCoverCacheLoadedKeyRef.current = boardCoverStorageKey
    boardCoverCacheRef.current = nextCache
    setBoardCoverCache(nextCache)
    setLatestTaskPreviewByProject({})
    setBoardCoverCacheReady(true)
  }, [boardCoverStorageKey, isLoading])

  useEffect(() => {
    if (!boardCoverCacheReady || boardCoverCacheLoadedKeyRef.current !== boardCoverStorageKey) {
      return
    }

    if (!token || projects.length === 0 || selectedProjectId) {
      return
    }

    const nextCache = { ...boardCoverCacheRef.current }
    let cacheChanged = false
    const storedAt = Date.now()

    for (const project of projects) {
      if (nextCache[project.project_id]) {
        continue
      }

      const boardPreview = getLatestProjectPreviewImages(boardStates[project.project_id]?.canvasAssets)[0] ?? null
      if (!boardPreview) {
        continue
      }

      nextCache[project.project_id] = {
        src: boardPreview,
        mode: "pinned",
        projectUpdatedAt: project.updated_at ?? null,
        fallbackSrc: boardPreview,
        storedAt,
      }
      cacheChanged = true
    }

    if (cacheChanged) {
      commitBoardCoverCache(nextCache)
    }
  }, [boardCoverCacheReady, boardCoverStorageKey, boardStates, commitBoardCoverCache, projects, selectedProjectId, token])

  useEffect(() => {
    if (!selectedProjectId) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyProjectsRef.current.has(selectedProjectId)) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [selectedProjectId])

  useEffect(() => {
    const paramId = searchParams?.get("project") || null
    if (paramId && paramId !== selectedProjectId) {
      setSelectedProjectId(paramId)
    } else if (!paramId && selectedProjectId) {
      setSelectedProjectId(null)
    }
  }, [searchParams, selectedProjectId])

  const fetchProjectDetail = useCallback(
    async (projectId: string) => {
      if (!token) return
      if (detailRequestsRef.current[projectId]) {
        await detailRequestsRef.current[projectId]
        return
      }
      const pending = (async () => {
        try {
          const response = await fetch(`/api/proxy/projects/${projectId}?include_board=true`, {
            method: "GET",
            headers: buildAuthHeaders(token),
            cache: "no-store",
          })
          const data = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error((data as { detail?: string } | null)?.detail || "Failed to fetch project detail")
          }
          const project = (data as { project?: ProjectSummary } | null)?.project ?? (data as ProjectSummary | null)
          if (project?.project_id) {
            setProjects((prev) => {
              const existing = prev.find((item) => item.project_id === project.project_id)
              return sortProjects([
                ...prev.filter((item) => item.project_id !== project.project_id),
                {
                  ...existing,
                  ...project,
                  accessRole: existing?.accessRole ?? (project.user_id === user?.username ? "owner" : "shared"),
                  permission: existing?.permission,
                  project_content: project.project_content ?? existing?.project_content,
                },
              ])
            })
            hydrateBoardState(project.project_id, project.project_content, { force: true })
            boardLoadedRef.current[project.project_id] = true
          }
        } catch (error) {
          console.error("Failed to load project detail:", error)
        } finally {
          detailRequestsRef.current[projectId] = null
        }
      })()
      detailRequestsRef.current[projectId] = pending
      await pending
    },
    [hydrateBoardState, token, user?.username],
  )

  useEffect(() => {
    if (!token || !selectedProjectId) return
    if (boardLoadedRef.current[selectedProjectId]) return
    void fetchProjectDetail(selectedProjectId)
  }, [fetchProjectDetail, selectedProjectId, token])

  useEffect(() => {
    if (!token || !selectedProjectId) {
      setRepositoryTasks([])
      return
    }
    let cancelled = false
    const fetchRepositoryTasks = async () => {
      try {
        const response = await fetch(`/api/proxy/projects/${selectedProjectId}/tasks`, {
          method: "GET",
          headers: buildAuthHeaders(token),
          cache: "no-store",
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data as { detail?: string } | null)?.detail || "Failed to fetch project tasks")
        }
        const list = Array.isArray((data as { tasks?: unknown }).tasks)
          ? ((data as { tasks: TaskHistoryItem[] }).tasks ?? [])
          : []
        const next = list.map((task) => {
          const taskId = task.tenant_task_id ?? String(task.id ?? "")
          const title = getBoardTaskTitle(task.task_type, taskId, locale)
          return {
            id: taskId,
            title,
            images: getTaskPreviewUrls(task),
            originalImages: getTaskOriginalUrls(task),
            date: task.completed_at || task.created_at || "",
            source: "task" as const,
            taskType: task.task_type,
            status: task.status,
            projectId: selectedProjectId,
          }
        })
        if (!cancelled) {
          setRepositoryTasks(next)
        }
      } catch (error) {
        console.error("Failed to load project tasks:", error)
        if (!cancelled) {
          setRepositoryTasks([])
        }
      }
    }
    const pending = fetchRepositoryTasks()
    tasksLoadPromiseRef.current = pending
    void pending.finally(() => {
      if (tasksLoadPromiseRef.current === pending) {
        tasksLoadPromiseRef.current = null
      }
    })
    return () => {
      cancelled = true
    }
  }, [locale, selectedProjectId, token])

  const refreshProjectTasks = useCallback(async (projectId?: string | null) => {
    const targetProjectId = projectId ?? selectedProjectId
    if (!token || !targetProjectId) return
    try {
      const response = await fetch(`/api/proxy/projects/${targetProjectId}/tasks`, {
        method: "GET",
        headers: buildAuthHeaders(token),
        cache: "no-store",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || "Failed to fetch project tasks")
      }
      const list = Array.isArray((data as { tasks?: unknown }).tasks)
        ? ((data as { tasks: TaskHistoryItem[] }).tasks ?? [])
        : []
      const next = list.map((task) => {
        const taskId = task.tenant_task_id ?? String(task.id ?? "")
        const title = getBoardTaskTitle(task.task_type, taskId, locale)
        return {
          id: taskId,
          title,
          images: getTaskPreviewUrls(task),
          originalImages: getTaskOriginalUrls(task),
          date: task.completed_at || task.created_at || "",
          source: "task" as const,
          taskType: task.task_type,
          status: task.status,
          projectId: targetProjectId,
        }
      })
      if (targetProjectId === selectedProjectId) {
        setRepositoryTasks(next)
      }
    } catch (error) {
      console.error("Failed to refresh project tasks:", error)
    }
  }, [locale, selectedProjectId, token])

  useEffect(() => {
    if (!boardCoverCacheReady || boardCoverCacheLoadedKeyRef.current !== boardCoverStorageKey) {
      return
    }

    if (!token || projects.length === 0 || selectedProjectId) {
      setLatestTaskPreviewByProject({})
      return
    }

    const cachedCoverLookup = boardCoverCacheRef.current
    const projectsToFetch = projects.filter((project) => !resolveCachedBoardCoverSrc(project.project_id, cachedCoverLookup))

    if (projectsToFetch.length === 0) {
      setLatestTaskPreviewByProject({})
      return
    }

    let cancelled = false
    const loadLatestTaskPreviews = async () => {
      const results = await Promise.allSettled(
        projectsToFetch.map(async (project) => {
          const response = await fetch(`/api/proxy/projects/${project.project_id}/tasks`, {
            method: "GET",
            headers: buildAuthHeaders(token),
            cache: "no-store",
          })
          const data = await response.json().catch(() => null)
          if (!response.ok) {
            return {
              projectId: project.project_id,
              preview: null as string | null,
              projectUpdatedAt: project.updated_at ?? null,
            }
          }
          const list = Array.isArray((data as { tasks?: unknown }).tasks)
            ? ((data as { tasks: TaskHistoryItem[] }).tasks ?? [])
            : []
          if (list.length === 0) {
            return {
              projectId: project.project_id,
              preview: null as string | null,
              projectUpdatedAt: project.updated_at ?? null,
            }
          }
          const sorted = [...list].sort((a, b) => {
            const aTime = Date.parse(a.completed_at || a.created_at || "")
            const bTime = Date.parse(b.completed_at || b.created_at || "")
            const safeA = Number.isFinite(aTime) ? aTime : -1
            const safeB = Number.isFinite(bTime) ? bTime : -1
            return safeB - safeA
          })
          for (const task of sorted) {
            const preview = getTaskPreviewUrls(task)[0] ?? getTaskOriginalUrls(task)[0] ?? null
            if (preview) {
              return {
                projectId: project.project_id,
                preview,
                projectUpdatedAt: project.updated_at ?? null,
              }
            }
          }
          return {
            projectId: project.project_id,
            preview: null as string | null,
            projectUpdatedAt: project.updated_at ?? null,
          }
        }),
      )

      if (cancelled) return
      const next: Record<string, string> = {}
      const nextCache = { ...boardCoverCacheRef.current }
      let cacheChanged = false
      const storedAt = Date.now()

      for (const settled of results) {
        if (settled.status !== "fulfilled") continue
        const { projectId, preview, projectUpdatedAt } = settled.value
        if (preview) {
          next[projectId] = preview
          nextCache[projectId] = {
            src: preview,
            mode: "pinned",
            projectUpdatedAt: projectUpdatedAt ?? null,
            fallbackSrc: preview,
            storedAt,
          }
          cacheChanged = true
        }
      }

      setLatestTaskPreviewByProject(next)
      if (cacheChanged) {
        commitBoardCoverCache(nextCache)
      }
    }

    void loadLatestTaskPreviews()
    return () => {
      cancelled = true
    }
  }, [boardCoverCacheReady, boardCoverStorageKey, commitBoardCoverCache, projects, selectedProjectId, token])

  const updateProjectParam = useCallback(
    (projectId: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() || "")
      if (projectId) {
        params.set("project", projectId)
      } else {
        params.delete("project")
      }
      const query = params.toString()
      router.replace(query ? `${pathname ?? "/"}?${query}` : pathname ?? "/")
    },
    [pathname, router, searchParams],
  )

  const tasks = useMemo(() => {
    return projects.map((project) => {
      const boardState = boardStates[project.project_id]
      const cachedPreview = resolveCachedBoardCoverSrc(project.project_id, boardCoverCache)
      const boardPreviewImages = cachedPreview ? [cachedPreview] : getLatestProjectPreviewImages(boardState?.canvasAssets)
      const fallbackPreview = latestTaskPreviewByProject[project.project_id]
      return {
        id: project.project_id,
        type: "PROJECT",
        date: formatProjectDate(project.updated_at || project.created_at, locale),
        title: getProjectDisplayName(project, locale),
        status: "active",
        images: boardPreviewImages.length > 0 ? boardPreviewImages : fallbackPreview ? [fallbackPreview] : [],
        isProtected: Boolean(project.project_content?.protected),
        canvasAssets: boardState?.canvasAssets ?? [],
        drawings: boardState?.drawings ?? [],
        viewState: boardState?.viewState ?? { offsetX: 0, offsetY: 0, scale: 1 },
      }
    })
  }, [boardCoverCache, boardStates, latestTaskPreviewByProject, locale, projects])

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null
    return tasks.find((task) => task.id === selectedProjectId) ?? null
  }, [selectedProjectId, tasks])
  const isSelectedBoardReady = Boolean(selectedProjectId && boardLoadedRef.current[selectedProjectId])
  const isBoardWorkspaceActive = Boolean(selectedProject && isSelectedBoardReady)

  const handleOpenBroadcastModal = useCallback(
    (index = 0) => {
      if (activeBroadcasts.length === 0) return
      setBroadcastModalBroadcasts(activeBroadcasts)
      setBroadcastModalIndex(Math.max(0, Math.min(index, activeBroadcasts.length - 1)))
      setIsBroadcastModalOpen(true)
    },
    [activeBroadcasts],
  )

  const handleDismissBroadcastSet = useCallback(
    (broadcasts: BoardBroadcast[]) => {
      const next = readDismissedBroadcastVersions()
      broadcasts.forEach((broadcast) => {
        next[String(broadcast.id)] = buildBoardBroadcastVersion(broadcast)
      })
      writeDismissedBroadcastVersions(next)
      refreshVisibleBroadcasts(activeBroadcasts)
    },
    [activeBroadcasts, refreshVisibleBroadcasts],
  )

  const handleCreateNewProject = async () => {
    if (isManager) return
    if (!token) return
    const name = copy.fallbacks.projectName || "Untitled Project"
    const currentViewState = selectedProjectId ? boardStates[selectedProjectId]?.viewState : null
    const viewState = {
      offsetX: currentViewState?.offsetX ?? 0,
      offsetY: currentViewState?.offsetY ?? 0,
      scale: currentViewState?.scale && currentViewState.scale > 0 ? currentViewState.scale : 1,
    }
    const boardTemplate = createNewProjectBoardTemplate(name, viewState)
    try {
      const response = await fetch("/api/proxy/projects", {
        method: "POST",
        headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name,
          project_content: {
            name,
            board: boardTemplate,
          },
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.createProject)
      }
      const created = (data?.project as ProjectSummary) ?? (data as ProjectSummary)
      if (created?.project_id) {
        const nextProject: ProjectSummary = {
          ...created,
          project_content: created.project_content ?? {
            name,
            board: boardTemplate,
          },
        }
        const nextTotal = projectTotal + 1
        setProjectPage(1)
        setProjectTotal(nextTotal)
        setProjectTotalPages(Math.max(1, Math.ceil(nextTotal / PROJECTS_PAGE_SIZE)))
        setProjects((prev) =>
          sortProjects([{ ...nextProject, accessRole: "owner" }, ...prev]).slice(0, PROJECTS_PAGE_SIZE),
        )
        hydrateBoardState(nextProject.project_id, nextProject.project_content)
        setSelectedProjectId(nextProject.project_id)
        updateProjectParam(nextProject.project_id)
      }
    } catch (error) {
      console.error("Failed to create project:", error)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    if (isManager) return
    if (!token) return
    const project = projects.find((item) => item.project_id === projectId)
    const projectName = getProjectDisplayName(project, locale)
    const isProtected = Boolean(project?.project_content?.protected)

    if (isProtected) {
      const typedName = window.prompt(copy.confirmations.deleteProtectedProject.replace("{project}", projectName), "")
      if (typedName === null) return
      if (typedName.trim() !== projectName) {
        window.alert(copy.errors.protectedNameMismatch)
        return
      }
    } else {
      const confirmed = window.confirm(copy.confirmations.deleteProject)
      if (!confirmed) return
    }

    try {
      const response = await fetch(`/api/proxy/projects/${projectId}`, {
        method: "DELETE",
        headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(isProtected ? { confirm_name: projectName } : {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.deleteProject)
      }
      setProjects((prev) => prev.filter((project) => project.project_id !== projectId))
      const nextTotal = Math.max(0, projectTotal - 1)
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PROJECTS_PAGE_SIZE))
      setProjectTotal(nextTotal)
      setProjectTotalPages(nextTotalPages)
      setBoardStates((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      if (boardCoverCacheRef.current[projectId]) {
        const nextCache = { ...boardCoverCacheRef.current }
        delete nextCache[projectId]
        commitBoardCoverCache(nextCache)
      }
      setLatestTaskPreviewByProject((prev) => {
        if (!prev[projectId]) return prev
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      if (projectPage > nextTotalPages) {
        setProjectPage(nextTotalPages)
      } else {
        setIsProjectsLoading(true)
        void fetchProjects()
      }
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null)
        updateProjectParam(null)
      }
    } catch (error) {
      console.error("Failed to delete project:", error)
    }
  }

  const handleRenameProject = useCallback(
    async (projectId: string, name: string) => {
      if (!token) return false
      if (isManager) return false
      const trimmed = name.trim()
      if (!trimmed) return false
      try {
        const response = await fetch(`/api/proxy/projects/${projectId}`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ name: trimmed }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data as { detail?: string } | null)?.detail || "Failed to rename project")
        }
        setProjects((prev) =>
          sortProjects(
            prev.map((project) =>
              project.project_id === projectId
                ? {
                    ...project,
                    project_content: { ...(project.project_content ?? {}), name: trimmed },
                  }
                : project,
            ),
          ),
        )
        return true
      } catch (error) {
        console.error("Failed to rename project:", error)
        return false
      }
    },
    [isManager, token],
  )

  const saveTimersRef = useRef<Record<string, number>>({})

  const syncBoardState = useCallback(
    async (projectId: string, nextState: BoardState, options?: { force?: boolean }) => {
      if (isManager) return
      if (!token) return
      if (hasPendingUploadAssets(nextState)) return
      const snapshot = JSON.stringify(nextState)
      if (!options?.force && lastSyncedRef.current[projectId] === snapshot) return
      pendingSyncCountRef.current += 1
      setIsSyncing(true)
      try {
        const payload = {
          project_content: {
            board: {
              version: 1,
              canvasAssets: nextState.canvasAssets,
              drawings: nextState.drawings,
              viewState: nextState.viewState,
              updatedAt: new Date().toISOString(),
            },
          },
        }
        const response = await fetch(`/api/proxy/projects/${projectId}`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data as { detail?: string } | null)?.detail || "Failed to sync board state")
        }
        if (data && typeof data === "object") {
          const project = (data as { project?: ProjectSummary }).project
          if (project?.project_id) {
            setProjects((prev) =>
              sortProjects(
                prev.map((item) =>
                  item.project_id === project.project_id
                    ? {
                        ...item,
                        ...project,
                        accessRole: item.accessRole,
                        permission: item.permission,
                        project_content: project.project_content ?? item.project_content,
                      }
                    : item,
                ),
              ),
            )
          }
        }
        setBoardStates((prev) => ({ ...prev, [projectId]: nextState }))
        lastSyncedRef.current[projectId] = snapshot
        dirtyProjectsRef.current.delete(projectId)
      } catch (error) {
        console.error("Failed to sync board state:", error)
      } finally {
        pendingSyncCountRef.current = Math.max(0, pendingSyncCountRef.current - 1)
        setIsSyncing(pendingSyncCountRef.current > 0)
      }
    },
    [isManager, token],
  )

  useEffect(() => {
    if (!token || isManager) return

    const refreshPendingGenerationTasks = async () => {
      if (boardGenerationPollInFlightRef.current) {
        return
      }

      const pendingByProject = new Map<string, string[]>()
      for (const [projectId, state] of Object.entries(boardStatesRef.current)) {
        const taskIds = getPendingGenerationTaskIds(state)
        if (taskIds.length > 0) {
          pendingByProject.set(projectId, taskIds)
        }
      }

      const taskIds = Array.from(new Set(Array.from(pendingByProject.values()).flat()))
      if (taskIds.length === 0) {
        return
      }

      boardGenerationPollInFlightRef.current = true
      try {
        const refreshResult = await redesignApiClient.refreshPoloapiTaskStatuses(taskIds)
        const taskById = new Map(
          (refreshResult.tasks || [])
            .filter((task) => typeof task?.tenant_task_id === "string" && task.tenant_task_id.length > 0)
            .map((task) => [task.tenant_task_id, task] as const),
        )
        if (taskById.size === 0) {
          return
        }

        const updatedStates = new Map<string, BoardState>()

        setBoardStates((prev) => {
          const next = { ...prev }
          let changed = false

          for (const [projectId, projectTaskIds] of pendingByProject.entries()) {
            const currentState = next[projectId]
            if (!currentState) continue

            let stateChanged = false
            const nextAssets = currentState.canvasAssets.map((asset) => {
              if (
                asset.type !== "image" ||
                asset.status !== "loading" ||
                !asset.tenantTaskId ||
                !projectTaskIds.includes(asset.tenantTaskId)
              ) {
                return asset
              }

              const task = taskById.get(asset.tenantTaskId)
              if (!task) {
                return asset
              }

              const normalizedStatus = String(task.status || "").toUpperCase()
              if (normalizedStatus === "SUCCESS" || normalizedStatus === "COMPLETED") {
                const outputUrl =
                  task.image_urls?.find((url): url is string => typeof url === "string" && url.length > 0) ||
                  task.thumbnail_urls?.find((url): url is string => typeof url === "string" && url.length > 0) ||
                  null
                if (!outputUrl) {
                  return asset
                }
                stateChanged = true
                return {
                  ...asset,
                  status: "ready" as const,
                  url: outputUrl,
                  previewUrl: outputUrl,
                  tenantTaskStatus: normalizedStatus,
                  tenantTaskError: null,
                }
              }

              if (normalizedStatus === "FAILED" || normalizedStatus === "ERROR") {
                const taskError = task.error_message || "Task generation failed. Please try again."
                if (asset.tenantTaskStatus === normalizedStatus && asset.tenantTaskError === taskError) {
                  return asset
                }
                stateChanged = true
                return {
                  ...asset,
                  tenantTaskStatus: normalizedStatus,
                  tenantTaskError: taskError,
                }
              }

              const pendingStatus = normalizedStatus || "PENDING"
              if (asset.tenantTaskStatus === pendingStatus) {
                return asset
              }
              stateChanged = true
              return {
                ...asset,
                tenantTaskStatus: pendingStatus,
                tenantTaskError: null,
              }
            })

            if (!stateChanged) {
              continue
            }

            const nextState: BoardState = {
              ...currentState,
              canvasAssets: nextAssets,
            }
            next[projectId] = nextState
            updatedStates.set(projectId, nextState)
            changed = true
          }

          return changed ? next : prev
        })

        if (updatedStates.size > 0) {
          setProjects((prev) =>
            sortProjects(
              prev.map((item) => {
                const nextState = updatedStates.get(item.project_id)
                if (!nextState) return item
                return {
                  ...item,
                  project_content: {
                    ...(item.project_content ?? {}),
                    board: {
                      version: 1,
                      canvasAssets: nextState.canvasAssets,
                      drawings: nextState.drawings,
                      viewState: nextState.viewState,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                }
              }),
            ),
          )

          for (const [projectId, nextState] of updatedStates.entries()) {
            void syncBoardState(projectId, nextState, { force: true })
          }
        }
      } catch (error) {
        console.warn("[board] background generation refresh failed:", error)
      } finally {
        boardGenerationPollInFlightRef.current = false
      }
    }

    void refreshPendingGenerationTasks()
    const timer = window.setInterval(() => {
      void refreshPendingGenerationTasks()
    }, 5000)

    return () => window.clearInterval(timer)
  }, [isManager, selectedProjectId, syncBoardState, token])

  const queueRemoteSave = useCallback(
    (projectId: string, nextState: BoardState) => {
      const timers = saveTimersRef.current
      if (timers[projectId]) {
        window.clearTimeout(timers[projectId])
      }
      timers[projectId] = window.setTimeout(async () => {
        await syncBoardState(projectId, nextState)
        delete saveTimersRef.current[projectId]
      }, 15000)
    },
    [syncBoardState],
  )

  const handleCanvasUpdate = (
    projectId: string,
    assets: CanvasAsset[],
    drawings: DrawingPath[],
    viewState: BoardState["viewState"],
  ) => {
    const nextState = { canvasAssets: assets, drawings, viewState }
    const snapshot = JSON.stringify(nextState)
    if (lastSyncedRef.current[projectId] && lastSyncedRef.current[projectId] !== snapshot) {
      dirtyProjectsRef.current.add(projectId)
    } else {
      dirtyProjectsRef.current.delete(projectId)
    }
    setBoardStates((prev) => ({ ...prev, [projectId]: nextState }))
    if (!hasPendingUploadAssets(nextState)) {
      queueRemoteSave(projectId, nextState)
    }
  }

  const handleSetProjectProtection = useCallback(
    async (projectId: string, nextProtected: boolean) => {
      if (!token) return false
      if (isManager) return false
      const project = projects.find((item) => item.project_id === projectId)
      if (!project) return false
      const projectName = getProjectDisplayName(project, locale)
      const message = nextProtected
        ? copy.confirmations.protectProject.replace("{project}", projectName)
        : copy.confirmations.unprotectProject.replace("{project}", projectName)
      if (!window.confirm(message)) {
        return false
      }

      try {
        const response = await fetch(`/api/proxy/projects/${projectId}`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ project_content: { protected: nextProtected } }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data as { detail?: string } | null)?.detail || copy.errors.updateProtection)
        }
        const updatedProject = (data?.project as ProjectSummary | undefined) ?? undefined
        setProjects((prev) =>
          sortProjects(
            prev.map((item) =>
              item.project_id === projectId
                ? {
                    ...item,
                    ...(updatedProject ?? {}),
                    accessRole: item.accessRole,
                    permission: item.permission,
                    project_content: {
                      ...(item.project_content ?? {}),
                      ...(updatedProject?.project_content ?? {}),
                      protected: nextProtected,
                    },
                  }
                : item,
            ),
          ),
        )
        return true
      } catch (error) {
        console.error("Failed to update project protection:", error)
        window.alert(copy.errors.updateProtection)
        return false
      }
    },
    [
      copy.confirmations.protectProject,
      copy.confirmations.unprotectProject,
      copy.errors.updateProtection,
      isManager,
      projects,
      token,
    ],
  )

  const handleImmediateSync = useCallback(
    async (projectId: string, assets: CanvasAsset[], drawings: DrawingPath[], viewState: BoardState["viewState"]) => {
      const nextState = { canvasAssets: assets, drawings, viewState }
      await syncBoardState(projectId, nextState, { force: true })
    },
    [syncBoardState],
  )

  useEffect(() => {
    if (pathname !== "/board") return
    const query = searchParams?.toString()
    lastBoardUrlRef.current = query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  const saveBoardBeforeLeave = useCallback(async () => {
    if (isManager || !token) {
      return true
    }

    const uploadsDeadline = Date.now() + 15000
    while (Object.values(boardStatesRef.current).some((state) => hasPendingUploadAssets(state))) {
      if (Date.now() > uploadsDeadline) {
        return false
      }
      await delay(300)
    }

    const settleDeadline = Date.now() + 10000
    while (pendingSyncCountRef.current > 0 && Date.now() <= settleDeadline) {
      await delay(250)
    }

    const dirtyProjectIds = Array.from(dirtyProjectsRef.current)
    for (const projectId of dirtyProjectIds) {
      const timer = saveTimersRef.current[projectId]
      if (timer) {
        window.clearTimeout(timer)
        delete saveTimersRef.current[projectId]
      }
      const state = boardStatesRef.current[projectId]
      if (!state) continue
      await syncBoardState(projectId, state, { force: true })
    }

    const finalDeadline = Date.now() + 10000
    while (pendingSyncCountRef.current > 0 && Date.now() <= finalDeadline) {
      await delay(250)
    }

    return (
      dirtyProjectsRef.current.size === 0 &&
      pendingSyncCountRef.current === 0 &&
      !Object.values(boardStatesRef.current).some((state) => hasPendingUploadAssets(state))
    )
  }, [isManager, token, syncBoardState])

  const openLeavePrompt = useCallback((targetUrl: string) => {
    setLeavePromptUrl(targetUrl)
    setLeavePromptError(null)
    setLeavePromptSaving(false)
  }, [])

  useEffect(() => {
    if (pathname !== "/board") {
      return
    }
    if (!isBoardWorkspaceActive) {
      return
    }
    if (isManager || !token) {
      return
    }
    if (typeof window === "undefined") {
      return
    }

    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState

    const normalizeTargetUrl = (input: string | URL | null | undefined) => {
      if (typeof input !== "string" && !(input instanceof URL)) {
        return null
      }
      try {
        const resolved = new URL(input.toString(), window.location.origin)
        return `${resolved.pathname}${resolved.search}${resolved.hash}`
      } catch {
        return null
      }
    }

    const shouldBlockNavigation = (targetUrl: string | null) => {
      if (!targetUrl) return false
      const targetPath = targetUrl.split("?")[0]?.split("#")[0] ?? targetUrl
      return targetPath !== "/board"
    }

    const blockNavigation = (targetUrl: string | null) => {
      if (!targetUrl || !shouldBlockNavigation(targetUrl)) {
        return false
      }
      openLeavePrompt(targetUrl)
      return true
    }

    window.history.pushState = function pushState(state, title, url) {
      if (blockNavigation(normalizeTargetUrl(url))) {
        return
      }
      return originalPushState.apply(this, [state, title, url])
    }

    window.history.replaceState = function replaceState(state, title, url) {
      if (blockNavigation(normalizeTargetUrl(url))) {
        return
      }
      return originalReplaceState.apply(this, [state, title, url])
    }

    const handlePopState = () => {
      const attemptedUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (!shouldBlockNavigation(attemptedUrl)) {
        return
      }
      const restoreUrl = lastBoardUrlRef.current || "/board"
      originalReplaceState.call(window.history, window.history.state, "", restoreUrl)
      openLeavePrompt(attemptedUrl)
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockNavigation(`${window.location.pathname}${window.location.search}${window.location.hash}`)) {
        return
      }
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("popstate", handlePopState)
    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.removeEventListener("popstate", handlePopState)
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [isBoardWorkspaceActive, isManager, openLeavePrompt, pathname, token])

  useEffect(() => {
    if (pathname !== "/board") return
    if (!isBoardWorkspaceActive) return
    if (typeof window === "undefined") return

    const handleNavigationRequest = (event: Event) => {
      const detail = (event as CustomEvent<BoardNavigationRequestDetail>).detail
      const targetUrl = typeof detail?.targetUrl === "string" ? detail.targetUrl : ""
      if (!targetUrl || targetUrl === "/board") {
        return
      }
      openLeavePrompt(targetUrl)
    }

    window.addEventListener("board-navigation-request", handleNavigationRequest)
    return () => window.removeEventListener("board-navigation-request", handleNavigationRequest)
  }, [isBoardWorkspaceActive, openLeavePrompt, pathname, router])

  useEffect(() => {
    if (pathname !== "/board") return
    if (!isBoardWorkspaceActive) return
    if (typeof window === "undefined") return

    const guard: BoardNavigationGuard = async (targetUrl: string) => {
      if (!targetUrl || targetUrl === "/board") {
        return false
      }
      openLeavePrompt(targetUrl)
      return true
    }

    ;(window as typeof window & { __fasiumBoardNavigationGuard?: BoardNavigationGuard }).__fasiumBoardNavigationGuard =
      guard

    return () => {
      const scopedWindow = window as typeof window & { __fasiumBoardNavigationGuard?: BoardNavigationGuard }
      if (scopedWindow.__fasiumBoardNavigationGuard === guard) {
        delete scopedWindow.__fasiumBoardNavigationGuard
      }
    }
  }, [isBoardWorkspaceActive, openLeavePrompt, pathname, router])

  const handleConfirmLeave = useCallback(async () => {
    if (!leavePromptUrl) return
    setLeavePromptSaving(true)
    setLeavePromptError(null)
    try {
      const saved = await saveBoardBeforeLeave()
      if (!saved) {
        setLeavePromptError(boardCopy.leavePrompt.error)
        return
      }
      const targetUrl = leavePromptUrl
      setLeavePromptUrl(null)
      if (typeof window !== "undefined") {
        window.location.assign(targetUrl)
        return
      }
      startTransition(() => {
        router.push(targetUrl)
      })
    } catch (error) {
      console.error("Failed to save board before leaving:", error)
      setLeavePromptError(boardCopy.leavePrompt.error)
    } finally {
      setLeavePromptSaving(false)
    }
  }, [boardCopy.leavePrompt.error, leavePromptUrl, router, saveBoardBeforeLeave])

  const handleDeleteRepositoryTasks = useCallback(
    async (taskIds: string[]) => {
      if (isManager) return false
      if (!token || !selectedProjectId || taskIds.length === 0) return false
      try {
        const response = await fetch(`/api/proxy/projects/${selectedProjectId}/tasks`, {
          method: "DELETE",
          headers: buildAuthHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ task_ids: taskIds }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data as { detail?: string } | null)?.detail || "删除任务失败")
        }
        setRepositoryTasks((prev) =>
          prev.filter((task) => !(task.projectId === selectedProjectId && taskIds.includes(task.id))),
        )
        return true
      } catch (error) {
        console.error("Failed to delete project tasks:", error)
        return false
      }
    },
    [isManager, selectedProjectId, token],
  )

  const boardRepositoryTasks = useMemo(() => {
    return Object.entries(boardStates).flatMap(([projectId, state]) => {
      if (!state) return []
      return (state.canvasAssets ?? [])
        .filter((asset) => asset.type === "image" && asset.url)
        .map((asset) => ({
          id: `board-${projectId}-${asset.id}`,
          title: asset.name || "画板素材",
          images: (() => {
            const previewUrl = getAssetPreviewUrl(asset)
            return previewUrl ? [previewUrl] : []
          })(),
          originalImages: asset.url ? [asset.url] : [],
          date: asset.createdAt || "",
          source: "board" as const,
          assetId: asset.id,
          projectId,
        }))
    })
  }, [boardStates])

  const combinedRepositoryTasks = useMemo(() => {
    return [...repositoryTasks, ...boardRepositoryTasks]
  }, [boardRepositoryTasks, repositoryTasks])

  useEffect(() => {
    if (isManager) return
    if (!token || !selectedProjectId) return
    const intervalId = window.setInterval(() => {
      const state = boardStatesRef.current[selectedProjectId]
      if (!state) return
      if (hasPendingUploadAssets(state)) return
      void syncBoardState(selectedProjectId, state)
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [isManager, selectedProjectId, syncBoardState, token])

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <main className="h-screen flex flex-col overflow-hidden">
        {selectedProject && isSelectedBoardReady ? (
          <ProjectCanvas
            project={selectedProject}
            onBack={async (state) => {
              if (isLeavingBoard) return
              setIsLeavingBoard(true)
              const projectId = selectedProjectId
              const currentState =
                projectId && state
                  ? { canvasAssets: state.assets, drawings: state.drawings, viewState: state.viewState }
                  : projectId
                    ? boardStatesRef.current[projectId]
                    : null
              if (!isManager && projectId && currentState) {
                await syncBoardState(projectId, currentState, { force: true })
              }
              if (tasksLoadPromiseRef.current) {
                try {
                  await tasksLoadPromiseRef.current
                } catch {
                  // ignore task list failures on exit
                }
              }
              if (typeof window !== "undefined") {
                window.location.assign("/board")
                return
              }
              startTransition(() => {
                setSelectedProjectId(null)
                router.replace("/board")
              })
            }}
            onApplyTool={() => {}}
            onUpdate={(assets, drawings, viewState) =>
              handleCanvasUpdate(selectedProject.id, assets, drawings, viewState)
            }
            onSyncNow={(assets, drawings, viewState) =>
              handleImmediateSync(selectedProject.id, assets, drawings, viewState)
            }
            isSyncing={isSyncing}
            repositoryTasks={combinedRepositoryTasks}
            onRefreshRepositoryTasks={refreshProjectTasks}
            onDeleteRepositoryTasks={handleDeleteRepositoryTasks}
            onRenameProject={handleRenameProject}
            readOnly={isManager}
            isLeaving={isLeavingBoard}
          />
        ) : selectedProjectId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-slate-500">正在加载画板...</div>
          </div>
        ) : (
          <RecordView
            tasks={tasks}
            onSelectProject={(task) => {
              const project = projects.find((item) => item.project_id === task.id)
              hydrateBoardState(task.id, project?.project_content)
              setSelectedProjectId(task.id)
              updateProjectParam(task.id)
            }}
            onDeleteProject={handleDeleteProject}
            onToggleProjectProtection={handleSetProjectProtection}
            onCreateProject={handleCreateNewProject}
            currentPage={projectPage}
            totalPages={projectTotalPages}
            totalItems={projectTotal}
            onPageChange={(page) => {
              if (page === projectPage) return
              setProjectPage(page)
            }}
            isLoading={isProjectsLoading}
            canManageProjects={!isManager}
            activeBroadcasts={activeBroadcasts}
            onOpenBroadcasts={handleOpenBroadcastModal}
          />
        )}
        <BoardBroadcastModal
          broadcasts={broadcastModalBroadcasts}
          open={isBroadcastModalOpen}
          startIndex={broadcastModalIndex}
          onOpenChange={setIsBroadcastModalOpen}
          onDismissForLater={handleDismissBroadcastSet}
        />
        {isLeavingBoard && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-6">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white px-6 py-5 shadow-2xl">
              <div className="text-base font-semibold text-slate-900">{boardCopy.savingOverlay.title}</div>
              <div className="mt-2 text-sm text-slate-600">{boardCopy.savingOverlay.description}</div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-1/3 rounded-full bg-slate-900 animate-pulse" />
              </div>
            </div>
          </div>
        )}
        {leavePromptUrl && (
          <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
            <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-2xl">
              <div className="text-lg font-semibold text-slate-900">{boardCopy.leavePrompt.title}</div>
              <div className="mt-2 text-sm text-slate-600">{boardCopy.leavePrompt.description}</div>
              {leavePromptError && (
                <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {leavePromptError}
                </div>
              )}
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (leavePromptSaving) return
                    setLeavePromptUrl(null)
                    setLeavePromptError(null)
                  }}
                  disabled={leavePromptSaving}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {boardCopy.leavePrompt.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmLeave()}
                  disabled={leavePromptSaving}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
                >
                  {leavePromptSaving ? boardCopy.leavePrompt.saving : boardCopy.leavePrompt.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
