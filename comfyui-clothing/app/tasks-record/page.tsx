"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"

import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { redesignApiClient, type TaskHistoryItem } from "@/lib/redesign-api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Download,
  ListChecks,
  Clock,
  Search,
  X,
  Wand2,
  Scissors,
  Grid3X3,
  Palette,
  Shirt,
  Video,
  Diamond,
  Loader2,
  Check,
  LayoutGrid,
  Plus,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/use-toast"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Messages } from "@/lib/i18n/translations"

const TASKS_PER_PAGE = 10

const STATUS_BADGE_STYLES: Record<string, string> = {
  SUCCESS: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  COMPLETED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  FAILED: "border-rose-500/25 bg-rose-500/10 text-rose-200",
  ERROR: "border-rose-500/25 bg-rose-500/10 text-rose-200",
  PENDING: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  RUNNING: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  COMPLETING: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  PROCESSING: "border-sky-500/25 bg-sky-500/10 text-sky-200",
}
const DEFAULT_STATUS_BADGE_STYLE = "border-border/60 bg-muted/60 text-muted-foreground"
const SUCCESS_STATUSES = new Set(["SUCCESS", "COMPLETED"])
const FAILED_STATUSES = new Set(["FAILED", "ERROR"])
const RUNNING_STATUSES = new Set(["PENDING", "RUNNING", "PROCESSING", "COMPLETING"])
const TASK_TYPE_ICON_MAP: Record<string, LucideIcon> = {
  targeted_redesign: Wand2,
  pattern_extract: Scissors,
  seamless_pattern: Grid3X3,
  pattern_application: Palette,
  virtual_tryon: Shirt,
  video_generation: Video,
}
type TasksRecordMessages = Messages["tasksRecord"]

type ProjectSummary = {
  project_id: string
  user_id: string
  project_content?: {
    name?: string
    description?: string
    task_ids?: string[]
  }
  created_at?: string
  updated_at?: string
}

type ProjectWithAccess = ProjectSummary & {
  accessRole?: "owner" | "shared"
  permission?: string
}

type SharedProjectEntry = {
  project: ProjectSummary
  permission: string
  access_id?: string
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function formatCardMetaDate(value: string | null | undefined) {
  if (!value) {
    return "未知时间"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return formatDate(value)
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date)
}

function formatTaskTypeLabel(value?: string | null, copy?: TasksRecordMessages) {
  if (!value) {
    return copy?.taskTypes.default ?? "Uncategorized"
  }

  const fallback = value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")

  if (!copy) {
    return fallback
  }

  return copy.taskTypes[value as keyof TasksRecordMessages["taskTypes"]] ?? fallback
}

function getTaskTypeMeta(value?: string | null, copy?: TasksRecordMessages) {
  const label = formatTaskTypeLabel(value, copy)
  const icon = value && TASK_TYPE_ICON_MAP[value] ? TASK_TYPE_ICON_MAP[value] : ListChecks
  return { label, icon }
}

function formatProjectDisplayName(project: ProjectWithAccess, copy: TasksRecordMessages) {
  const base = project.project_content?.name || project.project_id
  const role = project.accessRole
  if (!role) {
    return base
  }

  const label = copy.projectRoleLabels[role]
  return label ? `${base} · ${label}` : base
}

const formatTemplate = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )

type StorageEntry =
  | string
  | {
      original?: string | null
      thumbnail?: string | null
      localPath?: string | null
      path?: string | null
    }

type BatchInfo = {
  batchId: string
  imageCount?: number
}

type PreviewMedia = {
  url: string
  kind: "image" | "video"
}

function normalizeToStaticImageUrl(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") {
    return null
  }
  if (/^https?:\/\//i.test(path) || path.startsWith("/api/")) {
    return path
  }
  let normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "")
  normalized = normalized.replace(/^output\//i, "")
  if (!normalized) {
    return null
  }
  return `/api/proxy/static/images/${normalized}`
}

function normalizeTaskDownloadUrl(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") {
    return null
  }
  if (path.startsWith("/api/proxy/") || path.startsWith("/proxy/") || path.startsWith("/static/")) {
    return path
  }

  let normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "")
  if (!normalized) {
    return null
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized)
      normalized = parsed.pathname.replace(/^\/+/, "")
    } catch {
      return normalized
    }
  }

  const prefixes = ["root/fasium/output/", "output/", "thumbnail/output/"]
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length)
      break
    }
  }

  normalized = normalized.replace(/^\/+/, "")
  if (!normalized) {
    return null
  }

  return `/api/proxy/static/images/${normalized}`
}

function getTaskImageUrls(task: TaskHistoryItem): string[] {
  if (Array.isArray(task.image_urls) && task.image_urls.length > 0) {
    return task.image_urls.filter((url): url is string => typeof url === "string" && url.length > 0)
  }
  if (!Array.isArray(task.storage_paths) || task.storage_paths.length === 0) {
    return []
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
      const normalized = normalizeToStaticImageUrl(entry.original ?? entry.localPath ?? entry.path)
      if (normalized) {
        urls.push(normalized)
      }
    }
  }
  return urls
}

function getTaskBatchInfo(task: TaskHistoryItem): BatchInfo | null {
  let payload: unknown = task.result_data
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }
  if (!payload || typeof payload !== "object") {
    return null
  }
  const batchIdValue = (payload as Record<string, unknown>).batch_id ?? (payload as Record<string, unknown>).batchId
  if (!batchIdValue) {
    return null
  }
  const imageCountValue =
    (payload as Record<string, unknown>).image_count ?? (payload as Record<string, unknown>).imageCount
  const imageCount =
    typeof imageCountValue === "number"
      ? imageCountValue
      : Array.isArray(task.image_urls)
        ? task.image_urls.length
        : undefined
  return {
    batchId: String(batchIdValue),
    imageCount,
  }
}

function getTaskVideoUrl(task: TaskHistoryItem): string | null {
  let payload: unknown = task.result_data
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const value = record.video_url ?? record.videoUrl ?? record.url
  return typeof value === "string" && value.length > 0 ? value : null
}

function isVideoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return false
  }
  return /\.(mp4|webm|mov|m4v)(?:\?|$)/i.test(url)
}

function getTaskCreditUsage(task: TaskHistoryItem): number | null {
  let payload: unknown = task.result_data
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const billing = record.billing
  const creditValue =
    (billing && typeof billing === "object"
      ? (billing as Record<string, unknown>).credits ?? (billing as Record<string, unknown>).credit
      : undefined) ??
    record.credits ??
    record.credit

  if (typeof creditValue === "number" && Number.isFinite(creditValue)) {
    return creditValue
  }
  if (typeof creditValue === "string" && creditValue.trim() !== "" && !Number.isNaN(Number(creditValue))) {
    return Number(creditValue)
  }
  return null
}

function CreditUsageBadge({ credits }: { credits: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="flex items-center gap-1 rounded-full border-border/60 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground"
        >
          <Diamond className="size-3" />
          <span>{credits}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>消耗 {credits} 点</TooltipContent>
    </Tooltip>
  )
}


function TaskActions({
  task,
  variant = "default",
}: {
  task: TaskHistoryItem
  variant?: "default" | "overlay"
}) {
  const { token } = useAuth()
  const { toast } = useToast()
  const { messages } = useI18n()
  const copy = messages.tasksRecord
  const videoUrl = getTaskVideoUrl(task)
  const batchInfo = getTaskBatchInfo(task)
  const downloadUrls =
    Array.isArray(task.image_urls) && task.image_urls.length > 0
      ? (task.image_urls.filter((url) => typeof url === "string") as string[])
      : batchInfo
        ? getTaskImageUrls(task)
        : []
  const hasBatch = Boolean(batchInfo) && !videoUrl
  const downloadUrl = videoUrl ?? downloadUrls[0] ?? null
  const proxiedDownloadUrl = normalizeTaskDownloadUrl(downloadUrl)
  const isOverlay = variant === "overlay"
  const containerClass = isOverlay
    ? "flex items-center justify-center gap-3"
    : "flex flex-wrap items-center justify-center gap-2 md:flex-nowrap"
  const downloadButtonClass = isOverlay
    ? "size-10 rounded-full border border-border bg-background text-foreground transition-transform duration-150 hover:scale-110 hover:bg-primary hover:text-primary-foreground hover:shadow-[0_10px_25px_rgba(34,197,94,0.35)]"
    : "rounded-full border border-border bg-muted/40 text-muted-foreground transition-transform duration-150 hover:scale-110 hover:bg-muted/60 hover:text-foreground hover:shadow-[0_0_12px_rgba(34,197,94,0.35)]"
  const disabledButtonClass = isOverlay
    ? "size-10 rounded-full bg-muted/50 text-muted-foreground"
    : "rounded-full border border-border bg-muted/40 text-muted-foreground"

  return (
    <div className={containerClass}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            {downloadUrl ? (
              <Button
                variant="ghost"
                size="icon"
                className={downloadButtonClass}
                aria-label={hasBatch ? copy.download.package : copy.download.original}
                onClick={async (event) => {
                  event.preventDefault()
                  if (hasBatch) {
                    if (!token) {
                      toast({
                        title: copy.download.notLoggedInTitle,
                        description: copy.download.notLoggedInDescription,
                        variant: "destructive",
                      })
                      return
                    }
                    try {
                      const response = await fetch("/api/proxy/tasks/download_batch", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                          tenant_task_id: task.tenant_task_id ?? String(task.id ?? ""),
                          image_urls: downloadUrls,
                          batch_id: batchInfo?.batchId,
                        }),
                      })
                      if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`)
                      }
                      const blob = await response.blob()
                      const objectUrl = URL.createObjectURL(blob)
                      const anchor = document.createElement("a")
                      anchor.href = objectUrl
                      anchor.download = `batch-${batchInfo?.batchId ?? "images"}.zip`
                      document.body.appendChild(anchor)
                      anchor.click()
                      document.body.removeChild(anchor)
                      URL.revokeObjectURL(objectUrl)
                    } catch (error) {
                      console.error("Batch download failed:", error)
                      toast({
                        title: copy.download.failureTitle,
                        description: copy.download.failureDescription,
                        variant: "destructive",
                      })
                    }
                    return
                  }

                  try {
                    const response = await fetch(proxiedDownloadUrl ?? downloadUrl)
                    if (!response.ok) {
                      throw new Error(`HTTP ${response.status}`)
                    }
                    const blob = await response.blob()
                    const objectUrl = URL.createObjectURL(blob)
                    const anchor = document.createElement("a")
                    anchor.href = objectUrl
                    const defaultExt = videoUrl ? "mp4" : "png"
                    const sourceUrl = proxiedDownloadUrl ?? downloadUrl
                    const extMatch = sourceUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
                    const ext = extMatch?.[1] || defaultExt
                    anchor.download = `${task.tenant_task_id ?? task.id}.${ext}`
                    document.body.appendChild(anchor)
                    anchor.click()
                    document.body.removeChild(anchor)
                    URL.revokeObjectURL(objectUrl)
                  } catch (error) {
                    console.error("Single file download failed:", error)
                    toast({
                      title: copy.download.failureTitle,
                      description: copy.download.failureDescription,
                      variant: "destructive",
                    })
                  }
                }}
              >
                {hasBatch ? (
                  <>
                    <Download className="size-4" />
                    <span className="sr-only">{copy.download.package}</span>
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    <span className="sr-only">{copy.download.original}</span>
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label={copy.download.none}
                className={disabledButtonClass}
              >
                <Download className="size-4" />
                <span className="sr-only">{copy.download.none}</span>
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {downloadUrl ? (hasBatch ? copy.download.package : copy.download.original) : copy.download.none}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function TaskOutputs({
  task,
  onPreview,
  onOpenBatch,
}: {
  task: TaskHistoryItem
  onPreview?: (url: string, kind?: "image" | "video") => void
  onOpenBatch?: (task: TaskHistoryItem) => void
}) {
  const { messages } = useI18n()
  const copy = messages.tasksRecord
  const videoUrl = getTaskVideoUrl(task)
  const previews =
    (Array.isArray(task.thumbnail_urls) && task.thumbnail_urls.length > 0
      ? task.thumbnail_urls
      : Array.isArray(task.image_urls)
        ? task.image_urls
        : []
    ).filter((url) => typeof url === "string") as string[]
  const originals =
    Array.isArray(task.image_urls) && task.image_urls.length > 0
      ? (task.image_urls.filter((url) => typeof url === "string") as string[])
      : previews

  if (videoUrl) {
    return (
      <button
        type="button"
        className="group w-full overflow-hidden rounded-xl border border-border bg-card/50 p-2 text-left transition-colors hover:border-border/80"
        onClick={() => onPreview?.(videoUrl, "video")}
      >
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted/30 text-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-16 items-center justify-center rounded-full border border-border bg-background">
              <Video className="size-8" />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold">{copy.taskCard.previewButton}</div>
              <div className="text-[11px] text-muted-foreground">{copy.taskCard.generatedOutput}</div>
            </div>
          </div>
        </div>
      </button>
    )
  }

  const batchInfo = getTaskBatchInfo(task)
  if (batchInfo && onOpenBatch) {
    const baseSources = previews.length > 0 ? previews : getTaskImageUrls(task)
    const collage: Array<string | null> = baseSources.slice(0, 4)
    while (collage.length < 4) {
      collage.push(null)
    }
    const count = batchInfo.imageCount ?? baseSources.length
    return (
      <button
        type="button"
        className="group w-full rounded-xl border border-border bg-card/50 p-2 text-left transition-colors hover:border-emerald-400/60"
        onClick={() => onOpenBatch(task)}
      >
        <div className="relative w-full rounded-2xl border border-border/60 bg-gradient-to-br from-amber-50/20 to-amber-200/30 p-3 text-black shadow-inner">
          <div className="absolute -top-3 left-6 h-4 w-20 rounded-t-lg bg-amber-100/80 shadow-lg"></div>
          <div className="rounded-lg border border-border/60 bg-card/90 p-1">
            <div className="grid grid-cols-2 gap-1">
              {collage.map((url, index) => (
                <div
                  key={`${task.tenant_task_id ?? task.id}-batch-thumb-${index}`}
                  className="aspect-square overflow-hidden rounded-md bg-white/50 shadow-sm"
                >
                  {url ? (
                    <Image
                      src={url}
                      alt={copy.batch.alt}
                      width={120}
                      height={120}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-110"
                      unoptimized
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-black/40">
                      {copy.taskCard.noPreview}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-300">
            <LayoutGrid className="size-4" />
            <span>{copy.taskCard.batchBadge}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {formatTemplate(copy.taskCard.batchSummary, {
              count: String(count ?? collage.filter(Boolean).length),
              action: copy.taskCard.viewBatch,
            })}
          </p>
        </div>
      </button>
    )
  }

  if (!previews.length) {
    return <span className="text-xs text-muted-foreground">{copy.taskCard.noOutputs}</span>
  }

  const limited = previews.slice(0, 4)

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {limited.map((url, index) => {
        const originalUrl = originals[index] ?? url
        return (
          <Tooltip key={`${task.tenant_task_id ?? task.id}-thumb-${index}`} delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={copy.taskCard.previewButton}
                  className="size-12 overflow-hidden rounded-md border border-border bg-muted/30 transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => {
                  if (onPreview && originalUrl) {
                    onPreview(originalUrl, isVideoUrl(originalUrl) ? "video" : "image")
                  }
                }}
              >
                  <Image
                    src={url}
                    alt={copy.taskCard.previewAlt}
                    width={48}
                    height={48}
                    className="size-full object-cover"
                    unoptimized
                  />
              </button>
            </TooltipTrigger>
                <TooltipContent className="w-60 space-y-2">
                  <div className="aspect-square overflow-hidden rounded-lg border border-border/40 bg-muted/60">
                    <Image
                      src={originalUrl}
                      alt={copy.taskCard.previewAlt}
                  width={224}
                  height={224}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              </div>
            <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                {copy.table.type}: {formatTaskTypeLabel(task.task_type, copy)}
              </p>
              <p>
                {copy.table.status}:{" "}
                {copy.statuses[
                  ((task.status ?? "unknown").toLowerCase() as keyof typeof copy.statuses)
                ] ?? task.status ?? copy.fallbacks.notAvailable}
              </p>
              <p>
                {copy.table.createdAt}: {formatDate(task.created_at)}
              </p>
            </div>
          </TooltipContent>
          </Tooltip>
        )
      })}
      {previews.length > limited.length && (
        <Badge variant="outline" className="rounded-full border-border/40 bg-muted/20 px-2 text-[11px]">
          +{previews.length - limited.length}
        </Badge>
      )}
    </div>
  )
}

function TaskGridCard({
  task,
  isSelected,
  onSelectionChange,
  onPreview,
  onOpenBatch,
}: {
  task: TaskHistoryItem
  isSelected: boolean
  onSelectionChange: (checked: boolean) => void
  onPreview: (url: string, kind?: "image" | "video") => void
  onOpenBatch?: (task: TaskHistoryItem) => void
}) {
  const { messages } = useI18n()
  const copy = messages.tasksRecord
  const status = (task.status ?? "UNKNOWN").toUpperCase()
  const tenantTaskId = task.tenant_task_id ?? String(task.id ?? "")
  const taskTypeMeta = getTaskTypeMeta(task.task_type, copy)
  const createdLabel = formatCardMetaDate(task.created_at)
  const batchInfo = getTaskBatchInfo(task)
  const videoUrl = getTaskVideoUrl(task)
  const batchImageSources = batchInfo ? getTaskImageUrls(task) : []
  const folderTiles = (() => {
    const tiles: Array<string | null> = batchInfo ? batchImageSources.slice(0, 4) : []
    while (tiles.length < 4) {
      tiles.push(null)
    }
    return tiles
  })()
  const batchImageCount =
    batchInfo && typeof batchInfo.imageCount === "number" ? batchInfo.imageCount : batchInfo ? batchImageSources.length : undefined
  const previewImage =
    batchInfo && batchImageSources.length > 0
      ? batchImageSources[0]
      : videoUrl || (Array.isArray(task.image_urls) && task.image_urls[0]) ||
        (Array.isArray(task.thumbnail_urls) && task.thumbnail_urls[0]) ||
        null
  const creditUsage = getTaskCreditUsage(task)
  const isVideoTask = (task.task_type ?? "").toLowerCase().includes("video")
  const isSuccessStatus = SUCCESS_STATUSES.has(status)
  const isFailedStatus = FAILED_STATUSES.has(status)
  const isRunningStatus = RUNNING_STATUSES.has(status)

  const handlePrimaryAction = () => {
    if (batchInfo && onOpenBatch) {
      onOpenBatch(task)
      return
    }
    if (videoUrl) {
      onPreview(videoUrl, "video")
      return
    }
    if (previewImage) {
      onPreview(previewImage, isVideoUrl(previewImage) ? "video" : "image")
    }
  }

  return (
    <div className="group flex h-full flex-col cursor-pointer">
      <div
        role="button"
        tabIndex={0}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-muted/60"
        onClick={handlePrimaryAction}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            handlePrimaryAction()
          }
        }}
      >
        {isVideoTask && videoUrl ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/30 text-foreground">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-20 items-center justify-center rounded-full border border-border bg-background">
                <Video className="size-10" />
              </div>
              <div className="text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.35em]">{copy.taskCard.previewButton}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{copy.taskCard.generatedOutput}</div>
              </div>
            </div>
          </div>
        ) : isVideoTask ? (
          <div
            className={`flex h-full w-full items-center justify-center ${
              isSuccessStatus
                ? "bg-emerald-500/10"
                : isFailedStatus
                  ? "bg-muted/70"
                  : "bg-sky-500/10"
            }`}
          >
            {isSuccessStatus ? (
              <Check className="size-24 text-emerald-500" strokeWidth={3} />
            ) : isFailedStatus ? (
              <X className="size-24 text-zinc-500" strokeWidth={3} />
            ) : (
              <Loader2 className="size-24 animate-spin text-sky-500" strokeWidth={3} />
            )}
          </div>
        ) : batchInfo ? (
          <div className="relative h-full w-full rounded-2xl bg-gradient-to-br from-amber-50/30 to-amber-200/40 p-4">
            <div className="absolute -top-4 left-8 h-5 w-24 rounded-t-xl bg-amber-100/85 shadow-xl"></div>
            <div className="rounded-xl border border-border/60 bg-card/90 p-2 shadow-lg">
              <div className="grid grid-cols-2 gap-1.5">
                {folderTiles.map((url, index) => (
                  <div
                    key={`${tenantTaskId}-folder-${index}`}
                    className="aspect-square overflow-hidden rounded-md bg-white/60"
                  >
                    {url ? (
                      <Image
                        src={url}
                        alt="batch item"
                        width={220}
                        height={220}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-110"
                        unoptimized
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[10px] text-black/40">
                        {copy.taskCard.noPreview}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : previewImage ? (
          <Image
            src={previewImage}
            alt={copy.taskCard.previewAlt}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 25vw"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {copy.taskCard.noPreview}
          </div>
        )}
        <div className="absolute inset-0 flex flex-col justify-between bg-background/70 px-4 py-3 opacity-0 backdrop-blur-[1px] transition-all duration-300 group-hover:opacity-100">
          <div className="flex items-start justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] ${
                STATUS_BADGE_STYLES[status] ?? DEFAULT_STATUS_BADGE_STYLE
              }`}
            >
              {copy.statuses[status.toLowerCase() as keyof typeof copy.statuses] ?? status}
            </span>
            <Checkbox
              aria-label={copy.taskCard.selectTask}
              checked={isSelected}
              onCheckedChange={(checked) => {
                onSelectionChange(checked === true)
              }}
              onClick={(event) => event.stopPropagation()}
              className="h-5 w-5 rounded-[4px] border border-border bg-background/60 text-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            />
          </div>
          <div
            className="flex items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <TaskActions task={task} variant="overlay" />
          </div>
        </div>
      </div>
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">
            <span className="text-primary">{taskTypeMeta.label}</span>
            <span className="text-muted-foreground/70">/</span>
            <span>{createdLabel}</span>
            {creditUsage !== null ? <CreditUsageBadge credits={creditUsage} /> : null}
          </div>
          {batchInfo && (
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-300">
              <LayoutGrid className="size-4" />
              <span>
                {formatTemplate(copy.batch.images, {
                  count: String(batchImageCount ?? batchImageSources.length ?? 0),
                  type: formatTaskTypeLabel(task.task_type, copy),
                })}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {isFailedStatus
              ? copy.statuses[status.toLowerCase() as keyof typeof copy.statuses] ?? copy.statuses.failed ?? "Failed"
              : batchInfo
                  ? copy.taskCard.viewBatch
                  : task.result_data
                    ? copy.taskCard.generatedOutput
                    : copy.taskCard.awaitingOutput}
          </p>
        </div>
    </div>
  )
}

function TasksRecordPageContent() {
  const { isAuthenticated, isLoading, token } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { toast } = useToast()
  const { messages } = useI18n()
  const copy = messages.tasksRecord
  const [tasks, setTasks] = useState<TaskHistoryItem[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "running" | "failed">("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null)
  const [batchViewer, setBatchViewer] = useState<{
    taskId: string
    batchId: string
    imageUrls: string[]
    createdAt?: string
    taskType?: string | null
    imageCount?: number
  } | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRemovingFromProject, setIsRemovingFromProject] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [isStatusRefreshing, setIsStatusRefreshing] = useState(false)
  const [taskTypes, setTaskTypes] = useState<string[]>([])
  const lastPendingKeyRef = useRef<string>("")
  const isStatusRefreshingRef = useRef(false)
  const isFetchingRef = useRef(false)
  const lastSearchParamsStringRef = useRef(searchParams?.toString() ?? "")
  const [projects, setProjects] = useState<ProjectWithAccess[]>([])
  const [projectTasks, setProjectTasks] = useState<TaskHistoryItem[]>([])
  const [projectTasksError, setProjectTasksError] = useState<string | null>(null)
  const [isProjectTasksLoading, setIsProjectTasksLoading] = useState(false)
  const [isProjectsLoading, setIsProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [isMovePopoverOpen, setIsMovePopoverOpen] = useState(false)
  const [isMovingToProject, setIsMovingToProject] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string>(() => searchParams?.get("project") ?? "all")
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [isManualUploadInProgress, setIsManualUploadInProgress] = useState(false)
  const activeTaskList = projectFilter === "all" ? tasks : projectTasks

  useEffect(() => {
    const paramValue = searchParams?.get("project") ?? "all"
    setProjectFilter((previous) =>
      previous === paramValue || (paramValue === null && previous === "all")
        ? previous
        : paramValue || "all",
    )
  }, [searchParams])

  useEffect(() => {
    const currentSearch = searchParams?.toString() ?? ""
    if (currentSearch === lastSearchParamsStringRef.current) {
      return
    }
    lastSearchParamsStringRef.current = currentSearch
  }, [searchParams])

  const collectPendingTenantIds = useCallback((items: TaskHistoryItem[] | undefined | null) => {
    if (!Array.isArray(items) || items.length === 0) {
      return []
    }
    return items
      .filter((task) => RUNNING_STATUSES.has((task.status ?? "").toUpperCase()))
      .map((task) => task.tenant_task_id || task.runninghub_task_id || "")
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  }, [])

  const triggerPendingRefresh = useCallback(
    (items: TaskHistoryItem[] | undefined | null) => {
      if (!isAuthenticated || isLoading) {
        return
      }
      if (isFetchingRef.current || isStatusRefreshingRef.current) {
        return
      }

      const pendingIds = collectPendingTenantIds(items)
      if (pendingIds.length === 0) {
        lastPendingKeyRef.current = ""
        return
      }

      const key = pendingIds.slice().sort().join("|")
      if (key === lastPendingKeyRef.current) {
        return
      }
      lastPendingKeyRef.current = key

      setIsStatusRefreshing(true)

      redesignApiClient
        .refreshTaskStatuses(pendingIds)
        .then((result) => {
          if (!result) {
            return
          }

          const refreshedTasks = Array.isArray(result.tasks) ? result.tasks : []
          const removedIds = Array.isArray(result.removed_ids)
            ? result.removed_ids.filter(
                (id): id is string => typeof id === "string" && id.length > 0,
              )
            : []

          if (removedIds.length > 0) {
            const removedIdSet = new Set(removedIds)
            setTasks((previous) =>
              previous.filter((task) => {
                const taskId = task.tenant_task_id ?? ""
                return !removedIdSet.has(taskId)
              }),
            )
            setProjectTasks((previous) =>
              previous.filter((task) => {
                const taskId = task.tenant_task_id ?? ""
                return !removedIdSet.has(taskId)
              }),
            )
            setSelectedTaskIds((previous) => {
              if (previous.size === 0) {
                return previous
              }
              const next = new Set(previous)
              removedIdSet.forEach((id) => next.delete(id))
              return next
            })
          }

          if (refreshedTasks.length > 0) {
            const refreshedById = new Map(
              refreshedTasks
                .map((task) => [task.tenant_task_id, task] as const)
                .filter(([taskId]) => typeof taskId === "string" && taskId.length > 0),
            )

            setTasks((previous) =>
              previous.map((task) => refreshedById.get(task.tenant_task_id) ?? task),
            )
            setProjectTasks((previous) =>
              previous.map((task) => refreshedById.get(task.tenant_task_id) ?? task),
            )
          }

          if (refreshedTasks.length === 0) {
            return
          }

          const stillRunning = refreshedTasks.some((task) =>
            RUNNING_STATUSES.has((task.status ?? "").toUpperCase()),
          )

          if (!stillRunning) {
            lastPendingKeyRef.current = ""
          }
        })
        .catch((error) => {
          console.error("刷新任务状态失败:", error)
          lastPendingKeyRef.current = ""
        })
        .finally(() => {
          setIsStatusRefreshing(false)
        })
    },
    [
      collectPendingTenantIds,
      isAuthenticated,
      isLoading,
      redesignApiClient,
      setProjectTasks,
      setSelectedTaskIds,
      setTasks,
    ],
  )

  const fetchProjects = useCallback(async () => {
    if (!token) {
      setProjects([])
      return
    }

    setIsProjectsLoading(true)
    setProjectsError(null)
    try {
      const [ownedResponse, sharedResponse] = await Promise.all([
        fetch("/api/proxy/projects", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch("/api/proxy/projects/shared", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ])

      const ownedData = await ownedResponse.json().catch(() => null)
      const sharedData = await sharedResponse.json().catch(() => null)

      if (!ownedResponse.ok) {
        throw new Error(
          (ownedData as { detail?: string } | null)?.detail || copy.errors.fetchProjects,
        )
      }
      if (!sharedResponse.ok) {
        throw new Error(
          (sharedData as { detail?: string } | null)?.detail || copy.errors.fetchProjects,
        )
      }

      const ownedProjects = Array.isArray(
        (ownedData as { projects?: unknown }).projects,
      )
        ? ((ownedData as { projects: ProjectSummary[] }).projects ?? [])
        : []

      const sharedProjects = Array.isArray(
        (sharedData as { projects?: unknown }).projects,
      )
        ? ((sharedData as { projects: SharedProjectEntry[] }).projects ?? [])
        : []

      const merged = new Map<string, ProjectWithAccess>()

      ownedProjects.forEach((project) => {
        merged.set(project.project_id, {
          ...project,
          accessRole: "owner",
        })
      })

      sharedProjects.forEach((entry) => {
        const project = entry.project
        if (!project?.project_id) {
          return
        }
        const existing = merged.get(project.project_id)
        if (existing && existing.accessRole === "owner") {
          return
        }
        merged.set(project.project_id, {
          ...project,
          accessRole: "shared",
          permission: entry.permission,
        })
      })

      setProjects(Array.from(merged.values()))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "加载项目列表失败"
      setProjectsError(message)
      toast({
        title: "无法加载项目",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsProjectsLoading(false)
    }
  }, [token, toast])

  const fetchProjectTasks = useCallback(
    async (projectId: string) => {
      if (!token) {
        return
      }
      setIsProjectTasksLoading(true)
      setProjectTasksError(null)
      try {
        const response = await fetch(`/api/proxy/projects/${projectId}/tasks`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        })

        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(
            (data as { detail?: string } | null)?.detail || copy.errors.fetchTasks,
          )
        }

        const list = Array.isArray((data as { tasks?: unknown }).tasks)
          ? ((data as { tasks: TaskHistoryItem[] }).tasks ?? [])
          : []
        setProjectTasks(list)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : copy.errors.fetchTasks
        setProjectTasks([])
        setProjectTasksError(message)
      } finally {
        setIsProjectTasksLoading(false)
      }
    },
    [token],
  )

  const handleProjectFilterChange = useCallback(
    (value: string) => {
      setProjectFilter(value)
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      if (value === "all") {
        params.delete("project")
      } else {
        params.set("project", value)
      }
      const query = params.toString()
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )


  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    isFetchingRef.current = isFetching
  }, [isFetching])

  useEffect(() => {
    isStatusRefreshingRef.current = isStatusRefreshing
  }, [isStatusRefreshing])

  useEffect(() => {
    if (!isAuthenticated || isLoading) {
      return
    }

    let isCancelled = false

    redesignApiClient
      .getTaskTypes()
      .then((types) => {
        if (isCancelled) {
          return
        }
        const sorted = Array.isArray(types) ? [...new Set(types)].sort() : []
        setTaskTypes(sorted)
        setTypeFilter((previous) => {
          if (previous === "all") {
            return previous
          }
          if (sorted.length === 0 || !sorted.includes(previous)) {
            return "all"
          }
          return previous
        })
      })
      .catch((error) => {
        console.error("获取任务类型列表失败:", error)
      })

    return () => {
      isCancelled = true
    }
  }, [isAuthenticated, isLoading, refreshToken, redesignApiClient])

useEffect(() => {
  if (!isAuthenticated) {
    return
  }

  let isCancelled = false

  const loadHistory = async () => {
      setIsFetching(true)
      setError(null)

      try {
        const taskTypeParam = typeFilter === "all" ? undefined : typeFilter
        const [history, count] = await Promise.all([
          redesignApiClient.getTaskHistory(
            currentPage,
            taskTypeParam,
            TASKS_PER_PAGE,
          ),
          redesignApiClient.getTaskHistoryCount(taskTypeParam),
        ])

        if (!isCancelled) {
          lastPendingKeyRef.current = ""
          setTasks(history)
          const minimumTotal =
            (currentPage - 1) * TASKS_PER_PAGE + history.length
          let safeCount =
            typeof count === "number" ? Math.max(count, minimumTotal) : minimumTotal

          if (history.length === TASKS_PER_PAGE && safeCount <= minimumTotal) {
            safeCount = minimumTotal + TASKS_PER_PAGE
          }
          setTotalCount(safeCount)
        }
      } catch (fetchError) {
        if (!isCancelled) {
          const message =
            fetchError instanceof Error
              ? fetchError.message
              : "无法加载任务记录，请稍后重试。"
          setError(message)
          setTasks([])
        }
      } finally {
        if (!isCancelled) {
          setIsFetching(false)
        }
      }
    }

    void loadHistory()

  return () => {
    isCancelled = true
  }
}, [isAuthenticated, currentPage, typeFilter, refreshToken])

  useEffect(() => {
    if (token) {
      void fetchProjects()
    } else {
      setProjects([])
    }
  }, [token, fetchProjects])

  useEffect(() => {
    if (!token || projectFilter === "all") {
      setProjectTasks([])
      setProjectTasksError(null)
      setIsProjectTasksLoading(false)
      return
    }
    void fetchProjectTasks(projectFilter)
  }, [fetchProjectTasks, projectFilter, token])

  const activeProject = useMemo(() => {
    if (projectFilter === "all") {
      return null
    }
    return projects.find((item) => item.project_id === projectFilter) ?? null
  }, [projectFilter, projects])
  const canUploadToProject = projectFilter !== "all" && activeProject?.accessRole === "owner"

  const effectiveTotalCount =
    projectFilter === "all" ? totalCount : projectTasks.length

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((effectiveTotalCount || 0) / TASKS_PER_PAGE)),
    [effectiveTotalCount],
  )

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    triggerPendingRefresh(activeTaskList)
  }, [activeTaskList, triggerPendingRefresh])

  useEffect(() => {
    lastPendingKeyRef.current = ""
    triggerPendingRefresh(activeTaskList)
  }, [activeTaskList, currentPage, projectFilter, typeFilter, triggerPendingRefresh])

  useEffect(() => {
    if (!isAuthenticated || isLoading) {
      return
    }

    const hasRunningTasks = activeTaskList.some((task) =>
      RUNNING_STATUSES.has((task.status ?? "").toUpperCase()),
    )
    if (!hasRunningTasks) {
      return
    }

    const timer = window.setInterval(() => {
      triggerPendingRefresh(activeTaskList)
    }, 10000)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeTaskList, isAuthenticated, isLoading, triggerPendingRefresh])

  useEffect(() => {
    setSelectedTaskIds(new Set())
  }, [projectFilter])

  const handlePreview = useCallback((url: string, kind: "image" | "video" = "image") => {
    setPreviewMedia({ url, kind })
  }, [])

  const handleOpenBatch = useCallback(
    (task: TaskHistoryItem) => {
      const batchInfo = getTaskBatchInfo(task)
      if (!batchInfo) {
        return
      }
      const imageUrls = getTaskImageUrls(task)
      if (imageUrls.length === 0) {
        toast({
          title: "暂无图片",
          description: "该图片包暂时没有可展示的图片。",
          variant: "destructive",
        })
        return
      }
      setBatchViewer({
        taskId: task.tenant_task_id ?? String(task.id ?? ""),
        batchId: batchInfo.batchId,
        imageUrls,
        createdAt: task.created_at ?? undefined,
        taskType: task.task_type ?? undefined,
        imageCount: batchInfo.imageCount ?? imageUrls.length,
      })
    },
    [toast],
  )

  const selectedTaskIdsArray = useMemo(
    () => Array.from(selectedTaskIds),
    [selectedTaskIds],
  )
  const hasSelection = selectedTaskIdsArray.length > 0
  const isProjectFilterActive = projectFilter !== "all"
  const isListLoading =
    isFetching || (isProjectFilterActive && isProjectTasksLoading)
  const effectiveError = isProjectFilterActive ? projectTasksError : error

  const handleDeleteSelected = useCallback(async () => {
    if (!hasSelection || isDeleting) {
      return
    }

    setIsDeleting(true)
    try {
      const deleted = await redesignApiClient.deleteTaskHistory(selectedTaskIdsArray)
      if (deleted > 0) {
        toast({
          title: "已删除任务历史",
          description: `成功删除 ${deleted} 条任务记录。`,
        })
        setSelectedTaskIds(new Set())
        setRefreshToken((previous) => previous + 1)
      } else {
        toast({
          title: "未删除任何记录",
          description: "未找到可删除的任务记录。",
        })
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "删除失败，请稍后重试。"
      toast({
        title: "删除失败",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }, [hasSelection, isDeleting, redesignApiClient, selectedTaskIdsArray, toast])

  const handleMoveToProject = useCallback(
    async (projectId: string) => {
      if (!token || selectedTaskIdsArray.length === 0) {
        return
      }

      setIsMovingToProject(true)
      try {
        const response = await fetch(`/api/proxy/projects/${projectId}/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ task_ids: selectedTaskIdsArray }),
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(
            (data as { detail?: string } | null)?.detail || "移动任务失败",
          )
        }

        toast({
          title: "任务已更新",
          description: "成功移动到所选项目。",
        })
        setIsMovePopoverOpen(false)
        setProjectsError(null)
        void fetchProjects()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "移动任务失败，请稍后重试。"
        toast({
          title: "移动任务失败",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsMovingToProject(false)
      }
    },
    [fetchProjects, selectedTaskIdsArray, toast, token],
  )

  const handleRemoveFromProject = useCallback(async () => {
    if (
      !token ||
      !isProjectFilterActive ||
      selectedTaskIdsArray.length === 0 ||
      isRemovingFromProject
    ) {
      return
    }

    setIsRemovingFromProject(true)
    try {
      const response = await fetch(
        `/api/proxy/projects/${projectFilter}/tasks`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ task_ids: selectedTaskIdsArray }),
        },
      )

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          (data as { detail?: string } | null)?.detail || "从项目移除失败",
        )
      }

      const removedCount =
        (data as { removed?: number } | null)?.removed ??
        selectedTaskIdsArray.length
      toast({
        title: "已从项目移除",
        description: `成功将 ${removedCount} 个任务移出项目。`,
      })
      setSelectedTaskIds(new Set())
      setProjectsError(null)
      void fetchProjects()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "从项目移除失败，请稍后重试。"
      toast({
        title: "从项目移除失败",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsRemovingFromProject(false)
    }
  }, [
    fetchProjects,
    isProjectFilterActive,
    isRemovingFromProject,
    projectFilter,
    selectedTaskIdsArray,
    setSelectedTaskIds,
    toast,
    token,
  ])

  const handleManualUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0 || projectFilter === "all") {
        return
      }

      if (!token) {
        toast({
          title: "需要登录",
          description: "请先登录后再上传到项目",
          variant: "destructive",
        })
        return
      }

      const selectedFiles = Array.from(fileList).filter(
        (file) => file && file.size > 0,
      )
      if (selectedFiles.length === 0) {
        return
      }

      setIsManualUploadInProgress(true)
      const formData = new FormData()
      selectedFiles.forEach((file) => {
        formData.append("files", file)
      })

      try {
        const response = await fetch(`/api/proxy/projects/${projectFilter}/uploads`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        })

        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => null)) as { detail?: string } | null
          throw new Error(payload?.detail || "上传失败，请稍后重试")
        }

        toast({
          title: "上传成功",
          description: `已将 ${selectedFiles.length} 张图片添加到当前项目`,
        })
        await fetchProjectTasks(projectFilter)
        await fetchProjects()
      } catch (uploadError) {
        const message =
          uploadError instanceof Error
            ? uploadError.message
            : "上传失败，请稍后重试"
        toast({
          title: "上传失败",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsManualUploadInProgress(false)
        if (fileUploadInputRef.current) {
          fileUploadInputRef.current.value = ""
        }
      }
    },
    [fetchProjectTasks, fetchProjects, projectFilter, toast, token],
  )

  const handleManualUploadInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void handleManualUploadFiles(event.target.files)
    },
    [handleManualUploadFiles],
  )

  const handleManualUploadButtonClick = useCallback(() => {
    if (!canUploadToProject || isManualUploadInProgress) {
      return
    }
    fileUploadInputRef.current?.click()
  }, [canUploadToProject, isManualUploadInProgress])

  const filteredTasks = useMemo(() => {
    const sourceTasks = projectFilter === "all" ? tasks : projectTasks
    const search = searchTerm.trim().toLowerCase()
    return sourceTasks.filter((task) => {
      const statusKey = (task.status ?? "").toUpperCase()
      if (statusFilter === "success" && !SUCCESS_STATUSES.has(statusKey)) {
        return false
      }
      if (statusFilter === "failed" && !FAILED_STATUSES.has(statusKey)) {
        return false
      }
      if (statusFilter === "running" && !RUNNING_STATUSES.has(statusKey)) {
        return false
      }
      if (typeFilter !== "all" && task.task_type !== typeFilter) {
        return false
      }
      if (search) {
        const fields = [
          task.tenant_task_id,
          task.runninghub_task_id,
          task.task_type,
          task.status,
        ]
        const matches = fields.some((field) =>
          typeof field === "string" && field.toLowerCase().includes(search),
        )
        if (!matches) {
          return false
        }
      }
      return true
    })
  }, [projectFilter, projectTasks, searchTerm, statusFilter, tasks, typeFilter])

  const visibleTaskIds = useMemo(
    () =>
      filteredTasks.map((task) => task.tenant_task_id ?? String(task.id ?? "")),
    [filteredTasks],
  )
  const groupLabelMap = useMemo(
    () => ({
      "today-morning": "今天上午",
      "today-afternoon": "今天下午",
      yesterday: "昨天",
      "day-before": "前天",
    }),
    [],
  )

  const getGroupKey = useCallback((createdAt?: string | null) => {
    if (!createdAt) {
      return null
    }
    const created = new Date(createdAt)
    if (Number.isNaN(created.getTime())) {
      return null
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const middayToday = new Date(startOfToday)
    middayToday.setHours(12, 0, 0, 0)

    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)

    const startOfDayBefore = new Date(startOfToday)
    startOfDayBefore.setDate(startOfDayBefore.getDate() - 2)

    if (created >= startOfToday) {
      return created < middayToday ? "today-morning" : "today-afternoon"
    }

    if (created >= startOfYesterday) {
      return "yesterday"
    }

    if (created >= startOfDayBefore) {
      return "day-before"
    }

    return null
  }, [])

  const paginationRange = useMemo(() => {
    const pages = totalPages
    const maxButtons = 5
    const buttons: number[] = []
    let start = Math.max(1, currentPage - Math.floor(maxButtons / 2))
    let end = start + maxButtons - 1

    if (end > pages) {
      end = pages
      start = Math.max(1, end - maxButtons + 1)
    }

    for (let page = start; page <= end; page += 1) {
      buttons.push(page)
    }

    return { buttons, start, end, pages }
  }, [currentPage, totalPages])

  const renderedGrid = useMemo(() => {
    if (isListLoading) {
      return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`grid-skeleton-${index}`}
              className="h-80 rounded-2xl border border-border bg-card/50 p-4 shadow-sm"
            >
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="mt-4 h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </div>
      )
    }

    if (!filteredTasks.length) {
      return (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {effectiveError ?? copy.states.empty}
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 xl:grid-cols-5">
        {filteredTasks.map((task) => {
          const tenantTaskId = task.tenant_task_id ?? String(task.id ?? "")
          const isChecked = selectedTaskIds.has(tenantTaskId)
          return (
            <TaskGridCard
              key={`grid-${tenantTaskId}`}
              task={task}
              isSelected={isChecked}
              onSelectionChange={(checked) => {
                setSelectedTaskIds((previous) => {
                  const next = new Set(previous)
                  if (checked) {
                    next.add(tenantTaskId)
                  } else {
                    next.delete(tenantTaskId)
                  }
                  return next
                })
              }}
              onPreview={handlePreview}
              onOpenBatch={handleOpenBatch}
            />
          )
        })}
      </div>
    )
  }, [effectiveError, filteredTasks, handleOpenBatch, handlePreview, isListLoading, selectedTaskIds, setSelectedTaskIds])

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10">
          <div className="mb-6 rounded-2xl border border-border bg-card/60 p-4 shadow-[0_20px_80px_rgba(5,5,5,0.15)] lg:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value as typeof statusFilter)
                    setCurrentPage(1)
                  }}
                >
                  <SelectTrigger className="w-[150px] rounded-xl border border-border bg-background text-sm text-foreground">
                    <SelectValue placeholder={copy.filters.statusPlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="border border-border bg-popover text-foreground">
                    {[
                      { value: "all", label: copy.filters.statusOptions.all },
                      { value: "success", label: copy.filters.statusOptions.success },
                      { value: "running", label: copy.filters.statusOptions.running },
                      { value: "failed", label: copy.filters.statusOptions.failed },
                    ].map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={typeFilter}
                  onValueChange={(value) => {
                    setTypeFilter(value)
                    setCurrentPage(1)
                  }}
                >
                  <SelectTrigger className="w-[140px] rounded-xl border border-border bg-background text-sm text-foreground">
                    <SelectValue placeholder={copy.filters.typePlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="border border-border bg-popover text-foreground">
                    <SelectItem value="all">{copy.filters.typeAll}</SelectItem>
                    {taskTypes.map((type) => {
                      const Icon = TASK_TYPE_ICON_MAP[type] ?? ListChecks
                      return (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            <Icon className="size-3.5 text-muted-foreground" />
                            <span>{formatTaskTypeLabel(type, copy)}</span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>

                <Select
                  value={projectFilter}
                  onValueChange={(value) => {
                    handleProjectFilterChange(value)
                    setCurrentPage(1)
                  }}
                >
                  <SelectTrigger className="w-[160px] rounded-xl border border-border bg-background text-sm text-foreground">
                    <SelectValue placeholder={copy.filters.projectPlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="border border-border bg-popover text-foreground">
                    <SelectItem value="all">{copy.filters.projectAll}</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.project_id} value={project.project_id}>
                        <div className="flex items-center justify-between gap-2">
                          <span>{formatProjectDisplayName(project, copy)}</span>
                          {project.accessRole && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              {copy.projectRoleLabels[project.accessRole]}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <div className="relative flex-1 min-w-[220px] sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={copy.search.placeholder}
                    className="h-10 rounded-xl border border-border bg-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  {searchTerm && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSearchTerm("")}
                      className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed
                    className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs uppercase tracking-[0.25em] text-primary-foreground"
                  >
                    <LayoutGrid className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {hasSelection && (
                <motion.div
                  key="bulk-actions"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                    {copy.selection.selectedCount.replace(
                      "{count}",
                      String(selectedTaskIdsArray.length),
                    )}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {isProjectFilterActive ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isRemovingFromProject}
                      onClick={handleRemoveFromProject}
                      className="rounded-xl bg-muted/60 text-foreground hover:bg-muted"
                    >
                      {isRemovingFromProject ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          {copy.selection.removing}
                        </>
                      ) : (
                        copy.selection.removeFromProject.replace(
                          "{count}",
                          String(selectedTaskIdsArray.length),
                        )
                      )}
                    </Button>
                    ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isDeleting}
                      onClick={handleDeleteSelected}
                      className="rounded-xl"
                    >
                      {isDeleting
                        ? copy.selection.deleting
                        : copy.selection.deleteSelected.replace("{count}", String(selectedTaskIdsArray.length))}
                    </Button>
                    )}
                    <Popover
                      open={isMovePopoverOpen}
                      onOpenChange={(open) => {
                        setIsMovePopoverOpen(open)
                        if (open && !isProjectsLoading) {
                          void fetchProjects()
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={
                            isMovingToProject ||
                            selectedTaskIdsArray.length === 0 ||
                            (!token && !projects.length)
                          }
                          className="rounded-xl border border-border bg-transparent text-foreground hover:bg-muted/60"
                        >
                          {isMovingToProject ? (
                            <>
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              {copy.selection.moving}
                            </>
                          ) : (
                            copy.selection.moveToProject
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 space-y-3 border-border bg-popover p-4 text-foreground" align="start">
                        <p className="text-sm font-medium">{copy.popover.chooseTarget}</p>
                        {isProjectsLoading ? (
                          <p className="text-sm text-muted-foreground">{copy.popover.loadingProjects}</p>
                        ) : projectsError ? (
                          <div className="space-y-2 text-sm text-rose-300">
                            <p>{projectsError}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setProjectsError(null)
                                void fetchProjects()
                              }}
                            >
                              {copy.popover.retry}
                            </Button>
                          </div>
                        ) : projects.length === 0 ? (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>{copy.popover.noProjects}</p>
                        <Button variant="outline" size="sm" onClick={() => router.push("/project")}>
                          {copy.popover.createProject}
                        </Button>
                      </div>
                        ) : (
                          <div className="space-y-2">
                            {projects.map((project) => {
                              const name = project.project_content?.name || project.project_id
                              const taskCount = project.project_content?.task_ids?.length || 0
                              return (
                                <Button
                                  key={project.project_id}
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-between text-foreground"
                                  onClick={() => void handleMoveToProject(project.project_id)}
                                  disabled={isMovingToProject}
                                >
                                  <span className="truncate">{name}</span>
                                  <Badge variant="outline" className="ml-2 border-border/60 text-[10px]">
                                    {taskCount}
                                  </Badge>
                                </Button>
                              )
                            })}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mb-8 flex flex-wrap items-center gap-4">
            <h2 className="font-serif text-2xl text-foreground">Recent Entries</h2>
            {canUploadToProject && (
              <>
                <input
                  ref={fileUploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={handleManualUploadInputChange}
                />
                <Tooltip delayDuration={150}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 rounded-full border-border text-foreground transition hover:bg-muted/60"
                      onClick={handleManualUploadButtonClick}
                      disabled={isManualUploadInProgress}
                    >
                      {isManualUploadInProgress ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      <span className="sr-only">{copy.upload.srOnly}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover text-foreground">
                    {copy.upload.tooltip}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-mono text-muted-foreground">
              {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date())}
            </span>
          </div>

          <div className="space-y-6">
            {renderedGrid}

            <div className="flex flex-col gap-2 text-muted-foreground md:flex-row md:items-center md:justify-between">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        if (currentPage > 1) {
                          setCurrentPage((previous) => Math.max(previous - 1, 1))
                        }
                      }}
                      aria-disabled={currentPage === 1}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                    />
                  </PaginationItem>
                  {paginationRange.start > 1 && (
                    <>
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            setCurrentPage(1)
                          }}
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>
                      {paginationRange.start > 2 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                    </>
                  )}
                  {paginationRange.buttons.map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        href="#"
                        isActive={page === currentPage}
                        onClick={(event) => {
                          event.preventDefault()
                          setCurrentPage(page)
                        }}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  {paginationRange.end < paginationRange.pages && (
                    <>
                      {paginationRange.end < paginationRange.pages - 1 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            setCurrentPage(paginationRange.pages)
                          }}
                        >
                          {paginationRange.pages}
                        </PaginationLink>
                      </PaginationItem>
                    </>
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        if (currentPage < totalPages) {
                          setCurrentPage((previous) => previous + 1)
                        }
                      }}
                      aria-disabled={currentPage >= totalPages}
                      className={currentPage >= totalPages ? "pointer-events-none opacity-50" : undefined}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        </main>

        <Dialog
          open={Boolean(previewMedia)}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewMedia(null)
            }
          }}
        >
          <DialogContent className="max-w-4xl border-border bg-popover text-foreground">
            {previewMedia && (
              <div className="relative mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-border/60 bg-muted/60">
                {previewMedia.kind === "video" ? (
                  <video
                    src={previewMedia.url}
                    className="h-full w-full object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <Image
                    src={previewMedia.url}
                    alt={copy.taskCard.previewAlt}
                    width={1280}
                    height={720}
                    className="h-full w-full object-contain"
                    unoptimized
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(batchViewer)}
          onOpenChange={(open) => {
            if (!open) {
              setBatchViewer(null)
            }
          }}
        >
          <DialogContent className="max-w-5xl border-border bg-popover text-foreground">
            {batchViewer && (
              <div className="space-y-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">{copy.headings.history}</p>
                    <h2 className="font-serif text-3xl text-foreground">
                      {copy.labels.packageBatch.replace("{id}", batchViewer.batchId.slice(0, 12))}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {formatTemplate(copy.batch.images, {
                        count: String(batchViewer.imageCount ?? batchViewer.imageUrls.length),
                        type: formatTaskTypeLabel(batchViewer.taskType, copy),
                      })}
                    </p>
                  </div>
                  {batchViewer.createdAt && (
                    <div className="text-right text-xs text-muted-foreground">
                      {formatTemplate(copy.detail.createdAt, {
                        date: formatDate(batchViewer.createdAt),
                      })}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {batchViewer.imageUrls.map((url, index) => (
                    <button
                      key={`${batchViewer.batchId}-${index}`}
                      type="button"
                      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card/50 text-left transition-colors hover:border-emerald-400/60"
                      onClick={() => setPreviewMedia({ url, kind: isVideoUrl(url) ? "video" : "image" })}
                    >
                      <div className="aspect-[3/4] w-full overflow-hidden bg-muted/60">
                        <Image
                          src={url}
                          alt={copy.labels.historyImageAlt.replace("{index}", String(index + 1))}
                          width={480}
                          height={720}
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                          unoptimized
                        />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                        <span>{copy.labels.imageLabel.replace("{index}", String(index + 1))}</span>
                        <span className="text-[10px] uppercase tracking-[0.35em] text-emerald-300">
                          {copy.labels.view}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

export default function TasksRecordPage() {
  const { messages } = useI18n()
  const copy = messages.tasksRecord

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          {copy.states.loading}
        </div>
      }
    >
      <TasksRecordPageContent />
    </Suspense>
  )
}
