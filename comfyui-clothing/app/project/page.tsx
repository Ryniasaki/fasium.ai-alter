"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { FolderGit2, Loader2, Plus, RefreshCcw, PlusCircle, Trash2, X } from "lucide-react"
import { notifyProjectActivity } from "@/lib/project-activity"
import type { Locale } from "@/lib/i18n/translations"

type ProjectContent = {
  name?: string
  description?: string
  task_ids?: string[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

type ProjectRecord = {
  project_id: string
  user_id: string
  project_content: ProjectContent
  created_at: string
  updated_at: string
}

type ProjectTeamMember = {
  access_id: string
  project_id: string
  user_id: string
  permission: string
  granted_by_user_id: string
  granted_at?: string
  updated_at?: string
}

type ProjectTeamInvite = {
  invite_id: string
  project_id: string
  owner_user_id: string
  target_user_id: string
  permission: string
  status: string
  invite_token?: string
  expires_at?: string | null
  message?: string | null
  created_at?: string
  updated_at?: string
}

type SharedProjectEntry = {
  project: ProjectRecord
  permission: string
  access_id?: string
}

type PendingInviteEntry = {
  project: ProjectRecord
  invite: ProjectTeamInvite
}

const CARD_PALETTES = [
  {
    background: "bg-gradient-to-br from-slate-900 via-purple-950/70 to-black",
    border: "border-purple-500/40",
    badge: "bg-purple-500/20 text-purple-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-cyan-950/70 to-black",
    border: "border-cyan-400/40",
    badge: "bg-cyan-500/20 text-cyan-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-emerald-950/70 to-black",
    border: "border-emerald-500/40",
    badge: "bg-emerald-500/20 text-emerald-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-rose-950/70 to-black",
    border: "border-rose-500/40",
    badge: "bg-rose-500/20 text-rose-100",
  },
]

const TEAM_CARD_PALETTES = [
  {
    background: "bg-gradient-to-br from-slate-900 via-blue-950/70 to-black",
    border: "border-blue-500/40",
    badge: "bg-blue-500/25 text-blue-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-amber-950/70 to-black",
    border: "border-amber-500/40",
    badge: "bg-amber-500/20 text-amber-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-teal-950/70 to-black",
    border: "border-teal-500/40",
    badge: "bg-teal-500/20 text-teal-100",
  },
  {
    background: "bg-gradient-to-br from-slate-900 via-indigo-950/70 to-black",
    border: "border-indigo-500/40",
    badge: "bg-indigo-500/20 text-indigo-100",
  },
]

const formatDate = (value: string, locale: Locale, fallback: string) => {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  const resolvedLocale = locale === "zh" ? "zh-CN" : "en-US"
  return date.toLocaleString(resolvedLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

const formatLabel = (value: string, dictionary: Record<string, string>, fallback: string) => {
  if (!value) return fallback
  return dictionary[value] || fallback
}

const formatTemplate = (template: string, values: Record<string, string | number>) => {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

export default function ProjectPage() {
  const router = useRouter()
  const { isAuthenticated, token, isLoading: authLoading } = useAuth()
  const { locale, messages } = useI18n()
  const copy = messages.project
  const formatDateWithLocale = useCallback(
    (value: string) => formatDate(value, locale, copy.fallbacks.notAvailable),
    [copy.fallbacks.notAvailable, locale],
  )
  const projectsCacheKey = useMemo(
    () => (token ? `projects_cache:${token}` : "projects_cache:anon"),
    [token],
  )

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newProjectName, setNewProjectName] = useState("")
  const [newProjectDescription, setNewProjectDescription] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"projects" | "team">("projects")
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [selectedTeamProject, setSelectedTeamProject] = useState<SharedProjectEntry | null>(null)
  const [teamMembers, setTeamMembers] = useState<ProjectTeamMember[]>([])
  const [memberSearch, setMemberSearch] = useState("")
  const [teamInvites, setTeamInvites] = useState<ProjectTeamInvite[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamSuccess, setTeamSuccess] = useState<string | null>(null)
  const [inviteForm, setInviteForm] = useState({
    targetUserId: "",
    permission: "viewer",
    expiresDays: "7",
  })
  const [removingAccessId, setRemovingAccessId] = useState<string | null>(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [updatingInviteId, setUpdatingInviteId] = useState<string | null>(null)
  const [sharedProjects, setSharedProjects] = useState<SharedProjectEntry[]>([])
  const [sharedLoading, setSharedLoading] = useState(false)
  const [sharedError, setSharedError] = useState<string | null>(null)
  const [pendingInvites, setPendingInvites] = useState<PendingInviteEntry[]>([])
  const [inviteListError, setInviteListError] = useState<string | null>(null)
  const [inviteListLoading, setInviteListLoading] = useState(false)
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null)
  const [inviteListSuccess, setInviteListSuccess] = useState<string | null>(null)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [teamCanManage, setTeamCanManage] = useState(false)
  const [descriptionProject, setDescriptionProject] = useState<ProjectRecord | null>(null)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const canInviteUsername = useMemo(
    () => new Set(teamMembers.map((member) => member.user_id)),
    [teamMembers],
  )

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/")
    }
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!token || typeof window === "undefined") return
    try {
      const cached = window.localStorage.getItem(projectsCacheKey)
      if (!cached) return
      const parsed = JSON.parse(cached)
      if (Array.isArray(parsed)) {
        setProjects(parsed)
        setIsLoading(false)
      }
    } catch (err) {
      console.warn("Failed to restore cached projects:", err)
    }
  }, [projectsCacheKey, token])

  const fetchProjects = useCallback(async () => {
    if (!token) {
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/proxy/projects", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.detail || copy.errors.loadProjects)
      }

      const list = Array.isArray(data?.projects) ? (data.projects as ProjectRecord[]) : []
      setProjects(list)
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(projectsCacheKey, JSON.stringify(list))
        } catch (err) {
          console.warn("Failed to cache projects:", err)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.errors.loadProjects
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [copy.errors.loadProjects, projectsCacheKey, token])

  useEffect(() => {
    if (token) {
      fetchProjects()
    }
  }, [fetchProjects, token])

  const sortedProjects = useMemo(() => {
    return [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
  }, [projects])

  const resetForm = useCallback(() => {
    setNewProjectName("")
    setNewProjectDescription("")
    setFormError(null)
  }, [])

  const handleCreateProject = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setFormError(null)
      setSuccessMessage(null)

      if (!newProjectName.trim()) {
        setFormError(copy.errors.nameRequired)
        return
      }

      if (!token) {
        setFormError(copy.errors.tokenMissing)
        return
      }

      setIsCreating(true)
      try {
        const response = await fetch("/api/proxy/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: newProjectName.trim(),
            description: newProjectDescription.trim() || undefined,
          }),
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.createProject)
        }

        const created: ProjectRecord =
          (data?.project as ProjectRecord) ?? (data as ProjectRecord)

        setProjects((previous) => {
          const withoutDuplicate = previous.filter(
            (project) => project.project_id !== created.project_id,
          )
          return [created, ...withoutDuplicate]
        })

        setSuccessMessage(copy.success.createProject)
        resetForm()
        setShowCreateModal(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.createProject
        setFormError(message)
      } finally {
        setIsCreating(false)
      }
    },
    [copy.errors.createProject, copy.errors.nameRequired, copy.errors.tokenMissing, copy.success.createProject, newProjectDescription, newProjectName, resetForm, token],
  )

  const fetchSharedProjects = useCallback(async () => {
    if (!token) {
      return
    }

    setSharedLoading(true)
    setSharedError(null)

    try {
      const response = await fetch("/api/proxy/projects/shared", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.detail || copy.errors.sharedProjects)
      }

      const list = Array.isArray(data?.projects) ? (data.projects as SharedProjectEntry[]) : []
      setSharedProjects(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.errors.sharedProjects
      setSharedError(message)
    } finally {
      setSharedLoading(false)
    }
  }, [copy.errors.sharedProjects, token])

  const handleManualRefresh = useCallback(() => {
    if (token) {
      fetchProjects()
    }
  }, [fetchProjects, token])

  const fetchPendingInvites = useCallback(async () => {
    if (!token) {
      return
    }

    setInviteListLoading(true)
    setInviteListError(null)
    setInviteListSuccess(null)

    try {
      const response = await fetch("/api/proxy/projects/invites", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.detail || copy.errors.pendingInvites)
      }

      const list = Array.isArray(data?.invites) ? (data.invites as PendingInviteEntry[]) : []
      setPendingInvites(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.errors.pendingInvites
      setInviteListError(message)
    } finally {
      setInviteListLoading(false)
    }
  }, [copy.errors.pendingInvites, token])

  useEffect(() => {
    if (token) {
      fetchPendingInvites()
    }
  }, [fetchPendingInvites, token])

  const handleRespondToInvite = useCallback(
    async (entry: PendingInviteEntry, status: "accepted" | "declined") => {
      if (!token) {
        return
      }

      setRespondingInviteId(entry.invite.invite_id)
      setInviteListError(null)
      setInviteListSuccess(null)

      try {
        const response = await fetch(
          `/api/proxy/projects/${entry.project.project_id}/team/invites/${entry.invite.invite_id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status }),
          },
        )

        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(data?.detail || "Failed to update invite")
        }

        const projectName = (entry.project.project_content?.name as string) || entry.project.project_id
        setInviteListSuccess(
          status === "accepted"
            ? formatTemplate(copy.success.joinProject, { project: projectName })
            : copy.success.declineInvite,
        )
        notifyProjectActivity({ scope: "invite", action: status })
        await fetchPendingInvites()
        await fetchSharedProjects()
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.updateInvite
        setInviteListError(message)
      } finally {
        setRespondingInviteId(null)
      }
    },
    [copy.errors.updateInvite, copy.success.declineInvite, copy.success.joinProject, fetchPendingInvites, fetchSharedProjects, token],
  )

  useEffect(() => {
    if (token && activeTab === "team") {
      fetchSharedProjects()
      fetchPendingInvites()
    }
  }, [activeTab, fetchPendingInvites, fetchSharedProjects, token])

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (!token) {
        setTeamMembers([])
        setTeamInvites([])
        setError(copy.errors.tokenMissing)
        return
      }

      if (typeof window !== "undefined") {
        const confirmed = window.confirm(copy.confirmations.deleteProject)
        if (!confirmed) {
          return
        }
      }

      setDeletingProjectId(projectId)
      setError(null)
      setSuccessMessage(null)

      try {
        const response = await fetch(`/api/proxy/projects/${projectId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.deleteProject)
        }

        setProjects((previous) => previous.filter((project) => project.project_id !== projectId))
        setSuccessMessage(copy.success.deleteProject)
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.deleteProject
        setError(message)
      } finally {
        setDeletingProjectId(null)
      }
    },
    [copy.confirmations.deleteProject, copy.errors.deleteProject, copy.errors.tokenMissing, copy.success.deleteProject, token],
  )

  const fetchTeamDetails = useCallback(
    async (projectId: string) => {
      if (!token || !projectId) {
        return
      }

      setTeamLoading(true)
      setTeamError(null)

      try {
        const response = await fetch(`/api/proxy/projects/${projectId}/team`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.loadTeam)
        }

        const members = Array.isArray(data?.members)
          ? (data.members as ProjectTeamMember[])
          : []
        const invites = Array.isArray(data?.invites)
          ? (data.invites as ProjectTeamInvite[])
              .filter((invite) => invite.status !== "accepted")
          : []

        setTeamMembers(members)
        setTeamInvites(invites)
        setTeamCanManage(Boolean(data?.can_manage))
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.loadTeam
        setTeamError(message)
        setTeamCanManage(false)
      } finally {
        setTeamLoading(false)
      }
    },
    [copy.errors.loadTeam, token],
  )

  const handleRemoveMember = useCallback(
    async (accessId: string) => {
      if (!token || !selectedProjectId) {
        return
      }
      if (!teamCanManage) {
        setTeamError(copy.errors.ownerOnlyMembers)
        return
      }

      setRemovingAccessId(accessId)
      setTeamError(null)
      setTeamSuccess(null)

      try {
        const response = await fetch(
          `/api/proxy/projects/${selectedProjectId}/team/members/${accessId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        )

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.removeMember)
        }

        setTeamSuccess(copy.success.memberRemoved)
        await fetchTeamDetails(selectedProjectId)
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.removeMember
        setTeamError(message)
      } finally {
        setRemovingAccessId(null)
      }
    },
    [copy.errors.ownerOnlyMembers, copy.errors.removeMember, copy.success.memberRemoved, fetchTeamDetails, selectedProjectId, teamCanManage, token],
  )

  const handleCreateInvite = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!token) {
        setTeamError(copy.errors.tokenMissing)
        return
      }
      if (!selectedProjectId) {
        setTeamError(copy.errors.selectProject)
        return
      }
      if (!teamCanManage) {
        setTeamError(copy.errors.ownerOnlyInvites)
        return
      }

      const targetUser = inviteForm.targetUserId.trim()
      if (!targetUser) {
        setTeamError(copy.errors.targetRequired)
        return
      }
      if (canInviteUsername.has(targetUser)) {
        setTeamError(copy.errors.alreadyMember)
        return
      }

      setCreatingInvite(true)
      setTeamError(null)
      setTeamSuccess(null)

      try {
        const expiresDays = Number(inviteForm.expiresDays)
        const expiresAtIso =
          !Number.isNaN(expiresDays) && expiresDays > 0
            ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined

        const response = await fetch(`/api/proxy/projects/${selectedProjectId}/team/invites`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_user_id: targetUser,
            permission: inviteForm.permission,
            expires_at: expiresAtIso,
          }),
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.createInvite)
        }

        setTeamSuccess(formatTemplate(copy.success.inviteSent, { user: targetUser }))
        setInviteForm({
          targetUserId: "",
          permission: inviteForm.permission,
          expiresDays: inviteForm.expiresDays,
        })
        await fetchTeamDetails(selectedProjectId)
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.createInvite
        setTeamError(message)
      } finally {
        setCreatingInvite(false)
      }
    },
    [
      canInviteUsername,
      fetchTeamDetails,
      inviteForm.permission,
      inviteForm.targetUserId,
      inviteForm.expiresDays,
      selectedProjectId,
      copy.errors.alreadyMember,
      copy.errors.createInvite,
      copy.errors.ownerOnlyInvites,
      copy.errors.selectProject,
      copy.errors.targetRequired,
      copy.errors.tokenMissing,
      copy.success.inviteSent,
      formatTemplate,
      teamCanManage,
      token,
    ],
  )

  const handleUpdateInviteStatus = useCallback(
    async (inviteId: string, status: "cancelled" | "accepted" | "declined") => {
      if (!token || !selectedProjectId) {
        return
      }
      if (!teamCanManage) {
        setTeamError(copy.errors.ownerOnlyStatus)
        return
      }

      setUpdatingInviteId(inviteId)
      setTeamError(null)
      setTeamSuccess(null)

      try {
        const response = await fetch(
          `/api/proxy/projects/${selectedProjectId}/team/invites/${inviteId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status }),
          },
        )

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.updateInvite)
        }

        setTeamSuccess(copy.success.inviteUpdated)
        await fetchTeamDetails(selectedProjectId)
      } catch (err) {
        const message = err instanceof Error ? err.message : copy.errors.updateInvite
        setTeamError(message)
      } finally {
        setUpdatingInviteId(null)
      }
    },
    [copy.errors.ownerOnlyStatus, copy.errors.updateInvite, copy.success.inviteUpdated, fetchTeamDetails, selectedProjectId, teamCanManage, token],
  )

  const handleOpenTeamModal = useCallback((entry: SharedProjectEntry) => {
    setSelectedTeamProject(entry)
    setSelectedProjectId(entry.project.project_id)
    setTeamModalOpen(true)
    setTeamError(null)
    setTeamSuccess(null)
    setTeamCanManage(entry.permission === "owner")
    setShowInviteForm(false)
  }, [])

  const handleCloseTeamModal = useCallback(() => {
    setTeamModalOpen(false)
    setSelectedProjectId("")
    setSelectedTeamProject(null)
    setTeamMembers([])
    setTeamInvites([])
    setTeamCanManage(false)
    setTeamError(null)
    setTeamSuccess(null)
    setInviteForm({ targetUserId: "", permission: "viewer", expiresDays: "7" })
    setShowInviteForm(false)
  }, [])

  useEffect(() => {
    if (!teamModalOpen || !selectedProjectId) {
      return
    }
    fetchTeamDetails(selectedProjectId)
  }, [fetchTeamDetails, selectedProjectId, teamModalOpen])

  const currentProjectName =
    (selectedTeamProject?.project.project_content?.name as string) ||
    selectedTeamProject?.project.project_id ||
    copy.fallbacks.selectedProject
  const currentProjectPermission = formatLabel(
    selectedTeamProject?.permission || "viewer",
    copy.permissions,
    copy.fallbacks.notAvailable,
  )

  const renderProjectCard = (project: ProjectRecord, index: number) => {
    const content = project.project_content || {}
    const taskIds = Array.isArray(content.task_ids) ? content.task_ids : []
    const taskCount = taskIds.length
    const projectName = (content.name as string) || copy.fallbacks.projectName
    const description = (content.description as string) || copy.fallbacks.description
    const palette = CARD_PALETTES[index % CARD_PALETTES.length]
    const previewLimit = 140
    const isLongDescription = description.length > previewLimit
    const previewDescription = isLongDescription ? `${description.slice(0, previewLimit)}…` : description
    const taskCountTemplate =
      taskCount === 1 ? copy.cards.taskCount.singular : copy.cards.taskCount.plural
    const taskCountLabel = formatTemplate(taskCountTemplate, { count: taskCount })
    const updatedLabel = formatTemplate(copy.cards.updated, { time: formatDateWithLocale(project.updated_at) })

    return (
      <div
        key={project.project_id}
        className={`relative overflow-hidden rounded-2xl p-4 space-y-3 border ${palette.border} ${palette.background}`}
      >
        <div className="absolute inset-0 opacity-30 blur-3xl pointer-events-none mix-blend-screen" />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">
              #{project.project_id}
            </p>
            <h2 className="text-xl font-semibold">{projectName}</h2>
          </div>
          <Badge className={`text-xs border-0 ${palette.badge}`}>
            {taskCountLabel}
          </Badge>
        </div>
        <p className="text-sm text-slate-100">{previewDescription}</p>
        {isLongDescription && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-slate-200 hover:text-white w-fit px-2"
            onClick={() => setDescriptionProject(project)}
          >
            {copy.cards.descriptionButton}
          </Button>
        )}
        <p className="text-xs text-slate-500">
          {updatedLabel}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Button variant="secondary" asChild size="sm">
            <Link href={`/tasks-record?project=${project.project_id}`}>{copy.cards.open}</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleOpenTeamModal({
                project,
                permission: "owner",
                access_id: `owner_${project.project_id}`,
              })
            }
          >
            {copy.cards.team}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDeleteProject(project.project_id)}
            disabled={deletingProjectId === project.project_id}
          >
            {deletingProjectId === project.project_id ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {copy.cards.deleting}
              </>
            ) : (
              <>
                <Trash2 className="mr-2 size-4" />
                {copy.cards.delete}
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900/60 text-white p-6 lg:p-10">
      <nav className="sticky top-0 z-20 -mx-6 -mt-6 mb-8 border-b border-slate-800/70 bg-slate-950/90 px-6 py-4 backdrop-blur-lg lg:-mx-10 lg:-mt-10 lg:px-10">
        <div className="max-w-6xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300/80">
              {copy.nav.badge}
            </p>
            <h1 className="text-xl font-bold mt-1 sm:text-2xl">{copy.nav.title}</h1>
          </div>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-4 text-xs text-slate-300">
          <p className="text-sm font-semibold text-white">交互说明</p>
          <div className="mt-2 space-y-1">
            <p>
              项目列表：<span className="font-mono text-[11px] text-white/80">GET /api/proxy/projects</span>、
              <span className="ml-1 font-mono text-[11px] text-white/80">GET /api/proxy/projects/shared</span>
            </p>
            <p>
              项目管理：<span className="font-mono text-[11px] text-white/80">POST /api/proxy/projects</span>、
              <span className="ml-1 font-mono text-[11px] text-white/80">DELETE /api/proxy/projects/{`{id}`}</span>
            </p>
            <p>
              邀请与团队：<span className="font-mono text-[11px] text-white/80">GET /api/proxy/projects/invites</span>、
              <span className="ml-1 font-mono text-[11px] text-white/80">PATCH /api/proxy/projects/{`{id}`}/team/invites/{`{inviteId}`}</span>
            </p>
            <p>
              成员管理：<span className="font-mono text-[11px] text-white/80">GET /api/proxy/projects/{`{id}`}/team</span>、
              <span className="ml-1 font-mono text-[11px] text-white/80">POST /api/proxy/projects/{`{id}`}/team/invites</span>、
              <span className="ml-1 font-mono text-[11px] text-white/80">DELETE /api/proxy/projects/{`{id}`}/team/members/{`{accessId}`}</span>
            </p>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "projects" | "team")}
          className="space-y-4"
        >
          <TabsList className="bg-slate-900/70">
            <TabsTrigger value="projects">{copy.tabs.personal}</TabsTrigger>
            <TabsTrigger value="team" className="relative">
              {copy.tabs.team}
              {pendingInvites.length > 0 && (
                <span className="pointer-events-none absolute -right-2 -top-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white/80 bg-red-600 px-[6px] text-[10px] font-semibold leading-none text-white shadow-[0_4px_10px_rgba(0,0,0,0.25)]">
                  {pendingInvites.length > 99 ? "99+" : pendingInvites.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="mt-0">
            <Card className="bg-slate-950/70 border-slate-800 text-white">
              <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle>{copy.projectList.title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleManualRefresh}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" /> {copy.projectList.refreshing}
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="mr-2 size-4" /> {copy.projectList.refresh}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      resetForm()
                      setSuccessMessage(null)
                      setShowCreateModal(true)
                    }}
                    aria-label={copy.projectList.addAria}
                  >
                    <PlusCircle className="size-5" />
                  </Button>
                  <Badge variant="secondary" className="w-fit">
                    {formatTemplate(copy.projectList.totalLabel, { count: projects.length })}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-500/40 rounded-lg px-4 py-2">
                    {error}
                  </div>
                )}
                {successMessage && !showCreateModal && (
                  <div className="text-sm text-emerald-300 bg-emerald-400/10 border border-emerald-500/30 rounded-lg px-4 py-2">
                    {successMessage}
                  </div>
                )}
                {isLoading ? (
                  <p className="text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {copy.projectList.loading}
                  </p>
                ) : sortedProjects.length === 0 ? (
                  <div className="text-muted-foreground flex items-center gap-2">
                    <FolderGit2 className="size-4" />
                    {copy.projectList.empty}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {sortedProjects.map((project, index) => renderProjectCard(project, index))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team" className="mt-0">
            <Card className="bg-slate-950/70 border-slate-800 text-white">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>{copy.shared.title}</CardTitle>
                  <CardDescription className="text-slate-300">{copy.shared.description}</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={fetchSharedProjects}
                  disabled={sharedLoading}
                >
                  {sharedLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {copy.shared.refreshing}
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="mr-2 size-4" />
                      {copy.shared.refresh}
                    </>
                  )}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {inviteListError && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-500/40 rounded-lg px-4 py-2">
                    {inviteListError}
                  </div>
                )}
                {inviteListSuccess && (
                  <div className="text-sm text-emerald-300 bg-emerald-400/10 border border-emerald-500/30 rounded-lg px-4 py-2">
                    {inviteListSuccess}
                  </div>
                )}
                {pendingInvites.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                    <div>
                      <h3 className="text-lg font-semibold text-amber-200">{copy.shared.pendingTitle}</h3>
                      <p className="text-sm text-amber-100/80">{copy.shared.pendingDescription}</p>
                    </div>
                    <div className="space-y-3">
                      {pendingInvites.map(({ invite, project }) => {
                        const content = project.project_content || {}
                        const name = (content.name as string) || project.project_id
                        const ownerLabel = formatTemplate(copy.shared.ownerMeta, {
                          owner: project.user_id,
                          time: formatDateWithLocale(project.updated_at),
                        })
                        return (
                          <div
                            key={invite.invite_id}
                            className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-slate-900/70 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{name}</p>
                                <p className="text-xs text-slate-500">{ownerLabel}</p>
                              </div>
                              <Badge variant="secondary">
                                {formatLabel(invite.permission, copy.permissions, copy.fallbacks.notAvailable)}
                              </Badge>
                            </div>
                            {invite.status === "pending" && (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleRespondToInvite({ invite, project }, "accepted")}
                                  disabled={respondingInviteId === invite.invite_id}
                                >
                                  {respondingInviteId === invite.invite_id ? (
                                    <>
                                      <Loader2 className="mr-2 size-4 animate-spin" />
                                      {copy.shared.joining}
                                    </>
                                  ) : (
                                    <>{copy.shared.accept}</>
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-amber-200"
                                  onClick={() => handleRespondToInvite({ invite, project }, "declined")}
                                  disabled={respondingInviteId === invite.invite_id}
                                >
                                  {respondingInviteId === invite.invite_id ? (
                                    <>
                                      <Loader2 className="mr-2 size-4 animate-spin" />
                                      {copy.shared.declining}
                                    </>
                                  ) : (
                                    <>{copy.shared.decline}</>
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {sharedError && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-500/40 rounded-lg px-4 py-2">
                    {sharedError}
                  </div>
                )}

                {inviteListLoading || sharedLoading ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {copy.shared.loading}
                  </p>
                ) : sharedProjects.length === 0 ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <FolderGit2 className="size-4" />
                    {copy.shared.empty}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {sharedProjects.map((entry, index) => {
                      const content = entry.project.project_content || {}
                      const projectName = (content.name as string) || entry.project.project_id
                      const description = (content.description as string) || copy.fallbacks.description
                      const palette = TEAM_CARD_PALETTES[index % TEAM_CARD_PALETTES.length]
                      const previewLimit = 140
                      const isLong = description.length > previewLimit
                      const preview = isLong ? `${description.slice(0, previewLimit)}…` : description
                      const ownerLabel = formatTemplate(copy.shared.ownerMeta, {
                        owner: entry.project.user_id,
                        time: formatDateWithLocale(entry.project.updated_at),
                      })
                      const permissionLabel = formatLabel(entry.permission, copy.permissions, copy.fallbacks.notAvailable)
                      return (
                        <div
                          key={entry.access_id || entry.project.project_id}
                          className={`relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3 border ${palette.border} ${palette.background}`}
                        >
                          <div className="absolute inset-0 opacity-25 blur-3xl pointer-events-none" />
                          <div className="flex items-center justify-between gap-3 relative z-10">
                              <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wide">
                                  #{entry.project.project_id}
                                </p>
                                <h3 className="text-lg font-semibold text-white">{projectName}</h3>
                              </div>
                              <Badge className={`border-0 ${palette.badge}`}>{permissionLabel}</Badge>
                            </div>
                            <p className="text-sm text-slate-100 relative z-10">{preview}</p>
                            {isLong && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-slate-100 hover:text-white w-fit px-2 relative z-10"
                                onClick={() => setDescriptionProject(entry.project)}
                              >
                                {copy.shared.descriptionButton}
                              </Button>
                            )}
                            <p className="text-xs text-slate-400 relative z-10">
                              {ownerLabel}
                            </p>
                            <div className="flex gap-2 relative z-10">
                              <Button variant="secondary" size="sm" asChild>
                                <Link href={`/tasks-record?project=${entry.project.project_id}`}>{copy.cards.open}</Link>
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handleOpenTeamModal(entry)}>
                                {copy.cards.team}
                              </Button>
                            </div>
                          </div>
                        )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {descriptionProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <Card className="w-full max-w-xl bg-slate-950 border-slate-800 text-white relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3"
              onClick={() => setDescriptionProject(null)}
              aria-label={copy.descriptionModal.closeAria}
            >
              <X className="size-5" />
            </Button>
            <CardHeader>
              <CardTitle>{descriptionProject.project_content?.name || descriptionProject.project_id}</CardTitle>
              <CardDescription className="text-slate-300">{copy.descriptionModal.subtitle}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-line">
                {descriptionProject.project_content?.description || copy.descriptionModal.empty}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {teamModalOpen && selectedTeamProject && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 transition-opacity duration-300">
          <Card className="w-full max-w-3xl bg-slate-950 border-slate-800 text-white relative animate-in zoom-in-95 fade-in duration-300">
            <div className="flex items-start justify-between p-6 pb-0">
              <div>
                <CardTitle>{currentProjectName}</CardTitle>
                <CardDescription className="text-slate-300">
                  {formatTemplate(copy.teamModal.roleLabel, { role: currentProjectPermission })}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectedProjectId && fetchTeamDetails(selectedProjectId)}
                  disabled={teamLoading}
                >
                  {teamLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {copy.teamModal.refreshing}
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="mr-2 size-4" />
                      {copy.teamModal.refresh}
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCloseTeamModal}
                  aria-label={copy.teamModal.closeAria}
                >
                  <X className="size-5" />
                </Button>
              </div>
            </div>
            <CardContent className="space-y-4 pt-4">

              {teamError && (
                <div className="text-sm text-red-400 bg-red-400/10 border border-red-500/40 rounded-lg px-4 py-2">
                  {teamError}
                </div>
              )}
              {teamSuccess && (
                <div className="text-sm text-emerald-300 bg-emerald-400/10 border border-emerald-500/30 rounded-lg px-4 py-2">
                  {teamSuccess}
                </div>
              )}
              {teamLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> {copy.teamModal.loading}
                </p>
              ) : (
                <div className="space-y-8">
                  <section className="space-y-4">
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">{copy.teamModal.members.title}</h3>
                        <p className="text-sm text-slate-400">
                          {formatTemplate(copy.teamModal.members.subtitle, { project: currentProjectName })}
                        </p>
                      </div>
                      <Badge variant="outline" className="w-fit">
                        {formatTemplate(copy.teamModal.members.totalLabel, { count: teamMembers.length })}
                      </Badge>
                    </div>
                    <Input
                      placeholder={copy.teamModal.members.searchPlaceholder}
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      className="bg-slate-900/60 border-slate-800"
                    />

                    {teamMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {copy.teamModal.members.empty}
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                        {teamMembers
                          .filter((member) =>
                            member.user_id.toLowerCase().includes(memberSearch.trim().toLowerCase()),
                          )
                          .map((member) => {
                          const isOwner = member.permission === "owner"
                          return (
                            <div
                              key={member.access_id}
                              className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                            >
                              <div>
                                <p className="font-medium">{member.user_id}</p>
                                <p className="text-xs text-slate-400">
                                  {formatTemplate(copy.teamModal.members.meta, {
                                    permission: formatLabel(
                                      member.permission,
                                      copy.permissions,
                                      copy.fallbacks.notAvailable,
                                    ),
                                    granter: member.granted_by_user_id,
                                    time: formatDateWithLocale(member.granted_at || member.updated_at || ""),
                                  })}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {!isOwner && teamCanManage && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-400 hover:text-red-200"
                                    onClick={() => handleRemoveMember(member.access_id)}
                                    disabled={removingAccessId === member.access_id}
                                  >
                                    {removingAccessId === member.access_id ? (
                                      <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        {copy.teamModal.members.removing}
                                      </>
                                    ) : (
                                      <>
                                        <Trash2 className="mr-2 size-4" />
                                        {copy.teamModal.members.remove}
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  {teamCanManage && (
                    <section className="space-y-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">{copy.teamModal.invites.title}</h3>
                          <p className="text-sm text-slate-400">{copy.teamModal.invites.subtitle}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-white"
                          onClick={() => setShowInviteForm((previous) => !previous)}
                        >
                          {showInviteForm ? <X className="size-5" /> : <Plus className="size-5" />}
                        </Button>
                      </div>

                      {showInviteForm && (
                        <form className="grid gap-4 md:grid-cols-5" onSubmit={handleCreateInvite}>
                          <div className="md:col-span-2 space-y-2">
                            <label className="text-sm font-medium">{copy.teamModal.invites.targetLabel}</label>
                            <Input
                              placeholder={copy.teamModal.invites.targetPlaceholder}
                              value={inviteForm.targetUserId}
                              onChange={(event) =>
                                setInviteForm((previous) => ({
                                  ...previous,
                                  targetUserId: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{copy.teamModal.invites.permissionLabel}</label>
                            <Select
                              value={inviteForm.permission}
                              onValueChange={(value) =>
                                setInviteForm((previous) => ({ ...previous, permission: value }))
                              }
                            >
                              <SelectTrigger className="bg-slate-900/70 border-slate-800">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-slate-800">
                                <SelectItem value="viewer">{copy.permissions.viewer}</SelectItem>
                                <SelectItem value="editor">{copy.permissions.editor}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{copy.teamModal.invites.expiryLabel}</label>
                            <Select
                              value={inviteForm.expiresDays}
                              onValueChange={(value) =>
                                setInviteForm((previous) => ({
                                  ...previous,
                                  expiresDays: value,
                                }))
                              }
                            >
                              <SelectTrigger className="bg-slate-900/70 border-slate-800">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-slate-800">
                                <SelectItem value="1">{copy.teamModal.invites.expiryOptions.one}</SelectItem>
                                <SelectItem value="3">{copy.teamModal.invites.expiryOptions.three}</SelectItem>
                                <SelectItem value="7">{copy.teamModal.invites.expiryOptions.seven}</SelectItem>
                                <SelectItem value="14">{copy.teamModal.invites.expiryOptions.fourteen}</SelectItem>
                                <SelectItem value="0">{copy.teamModal.invites.expiryOptions.none}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-end">
                            <Button type="submit" disabled={creatingInvite}>
                              {creatingInvite ? (
                                <>
                                  <Loader2 className="mr-2 size-4 animate-spin" />
                                  {copy.teamModal.invites.submitting}
                                </>
                              ) : (
                                <>
                                  <Plus className="mr-2 size-4" />
                                  {copy.teamModal.invites.submit}
                                </>
                              )}
                            </Button>
                          </div>
                        </form>
                      )}
                      {teamInvites.filter((invite) => invite.status !== "cancelled").length === 0 ? (
                      <p className="text-sm text-muted-foreground">{copy.teamModal.invites.empty}</p>
                    ) : (
                      <div className="space-y-3">
                        {teamInvites
                          .filter((invite) => invite.status !== "cancelled")
                          .map((invite) => {
                          const statusVariant =
                            invite.status === "accepted"
                              ? "secondary"
                              : invite.status === "pending"
                                ? "outline"
                                : "destructive"
                          return (
                            <div
                              key={invite.invite_id}
                              className="border border-slate-800 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                            >
                              <div>
                                <p className="font-medium">{invite.target_user_id}</p>
                                <p className="text-xs text-slate-400">
                                  {formatTemplate(copy.teamModal.invites.meta, {
                                    permission: formatLabel(
                                      invite.permission,
                                      copy.permissions,
                                      copy.fallbacks.notAvailable,
                                    ),
                                    created: formatDateWithLocale(invite.created_at || ""),
                                  })}
                                  {invite.expires_at && (
                                    <>
                                      {" "}
                                      {formatTemplate(copy.teamModal.invites.expires, {
                                        date: formatDateWithLocale(invite.expires_at),
                                      })}
                                    </>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={statusVariant as "secondary" | "outline" | "destructive"}>
                                  {formatLabel(invite.status, copy.inviteStatuses, copy.fallbacks.notAvailable)}
                                </Badge>
                                {invite.status === "pending" && teamCanManage && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleUpdateInviteStatus(invite.invite_id, "cancelled")}
                                    disabled={updatingInviteId === invite.invite_id}
                                  >
                                    {updatingInviteId === invite.invite_id ? (
                                      <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        {copy.teamModal.invites.cancelling}
                                      </>
                                    ) : (
                                      <>{copy.teamModal.invites.cancel}</>
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 transition-opacity duration-300">
          <Card className="w-full max-w-xl bg-slate-950 border-slate-800 text-white relative animate-in zoom-in-95 fade-in duration-300">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3"
              onClick={() => {
                setShowCreateModal(false)
                resetForm()
              }}
              aria-label={copy.form.closeAria}
            >
              <X className="size-5" />
            </Button>
            <CardHeader>
              <CardTitle>{copy.form.title}</CardTitle>
              <CardDescription className="text-slate-300">
                {copy.form.descriptionPrefix}
                <code className="text-xs">project.json</code>
                {copy.form.descriptionSuffix}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateProject}>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{copy.form.nameLabel}</label>
                  <Input
                    placeholder={copy.form.namePlaceholder}
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    required
                    maxLength={200}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{copy.form.descriptionLabel}</label>
                  <Textarea
                    placeholder={copy.form.descriptionPlaceholder}
                    value={newProjectDescription}
                    onChange={(event) => setNewProjectDescription(event.target.value)}
                    maxLength={2000}
                    rows={4}
                  />
                </div>

                {formError && <p className="text-sm text-red-400">{formError}</p>}
                {successMessage && <p className="text-sm text-emerald-300">{successMessage}</p>}

                <div className="flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateModal(false)
                      resetForm()
                    }}
                  >
                    {copy.form.cancel}
                  </Button>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {copy.form.submitting}
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 size-4" />
                        {copy.form.submit}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
