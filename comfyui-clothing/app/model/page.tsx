"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Trash2, Users, Shield, Layers, Image as ImageIcon, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { WatermarkOverlay } from "@/app/components/watermark-overlay"
import type { Locale, Messages } from "@/lib/i18n/translations"

type StorageEntry =
  | string
  | {
      original?: string | null
      thumbnail?: string | null
      localPath?: string | null
    }

type LoraRecord = {
  lora_id: string
  owner_user_id: string
  name: string
  description?: string | null
  access_user_ids: string[]
  file_entries: StorageEntry[]
  directory?: string | null
  training_status?: number
  preview_entry?: StorageEntry | null
  created_at?: string | null
  updated_at?: string | null
}

const MAX_UPLOAD_FILES = 20
const MIN_UPLOAD_FILES = 6
const MODEL_LIMIT = 3

type StatusDictionary = Record<
  string,
  {
    label: string
    description: string
  }
>

const getStatusMeta = (status: number | undefined, statuses: StatusDictionary) => {
  const key = String(status ?? 4)
  return statuses[key] ?? statuses["4"]
}

const formatTemplate = (template: string, values: Record<string, string | number>) => {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

const formatDateValue = (value: string | null | undefined, locale: Locale, fallback: string) => {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  const resolvedLocale = locale === "zh" ? "zh-CN" : "en-US"
  return parsed.toLocaleString(resolvedLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

const safeParseDate = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const hashStringToOffsets = (input: string) => {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  const abs = Math.abs(hash)
  return {
    offset1: abs % 10,
    offset2: Math.floor(abs / 10) % 10,
    offset3: Math.floor(abs / 100) % 30,
  }
}

const computeTrainingProgressInfo = (record: LoraRecord, nowTs: number) => {
  const createdAt = safeParseDate(record.created_at)
  if (!createdAt) return null
  const { offset1, offset2, offset3 } = hashStringToOffsets(record.lora_id || "")
  const imageCount = Math.max(1, record.file_entries?.length ?? 1)
  const stage1 = 60 + offset1
  const stage2 = Math.max(60, Math.round((imageCount / 2) * 60) + offset2)
  const stage3 = 30 + offset3
  const elapsedSeconds = (nowTs - createdAt.getTime()) / 1000
  const totalStageSeconds = stage1 + stage2 + stage3
  if (elapsedSeconds >= totalStageSeconds) {
    return { percent: 100, etaMinutes: 0 }
  }
  const stage2Elapsed = elapsedSeconds - stage1
  const percent = Math.max(0, Math.min(1, stage2Elapsed / stage2))
  const remainingSeconds = Math.max(0, stage1 + stage2 - elapsedSeconds)
  return {
    percent: Math.round(percent * 100),
    etaMinutes: Math.max(0, Math.ceil(remainingSeconds / 60)),
  }
}

const buildStaticImageUrl = (entry: StorageEntry | undefined): string | null => {
  if (!entry) return null
  if (typeof entry === "string") {
    if (entry.startsWith("http") || entry.startsWith("/api/")) {
      return entry
    }
    const normalized = entry.replace(/\\/g, "/").replace(/^\.?\/*/, "").replace(/^output\//i, "")
    return normalized ? `/api/proxy/static/images/${normalized}` : null
  }
  const rawPath = entry.original || entry.localPath || entry.thumbnail
  if (!rawPath) return null
  if (rawPath.startsWith("http") || rawPath.startsWith("/api/")) {
    return rawPath
  }
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.?\/*/, "").replace(/^output\//i, "")
  return normalized ? `/api/proxy/static/images/${normalized}` : null
}

function useLoraRecords(copy: Messages["model"]) {
  const { token } = useAuth()
  const { toast } = useToast()
  const [records, setRecords] = useState<LoraRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecords = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/models/lora", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.fetchRecords)
      }
      const items = Array.isArray((data as { items?: unknown }).items) ? ((data as { items?: LoraRecord[] }).items ?? []) : []
      setRecords(items)
    } catch (err) {
      console.error("Failed to load lora records:", err)
      setError(err instanceof Error ? err.message : copy.errors.fetchRecords)
      toast({
        title: copy.toasts.loadError.title,
        description: err instanceof Error ? err.message : copy.toasts.loadError.description,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [copy.errors.fetchRecords, copy.toasts.loadError.description, copy.toasts.loadError.title, toast, token])

  useEffect(() => {
    if (token) {
      void fetchRecords()
    }
  }, [fetchRecords, token])

  return { records, isLoading, error, refetch: fetchRecords }
}

export default function ModelPage() {
  const { user, token, isAuthenticated } = useAuth()
  const { toast } = useToast()
  const { locale, messages } = useI18n()
  const copy = messages.model
  const formatDateWithLocale = useCallback(
    (value?: string | null) => formatDateValue(value, locale, copy.misc.dateFallback),
    [copy.misc.dateFallback, locale],
  )
  const { records, isLoading, error, refetch } = useLoraRecords(copy)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<LoraRecord | null>(null)
  const [activePreviewIndex, setActivePreviewIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmRecord, setDeleteConfirmRecord] = useState<LoraRecord | null>(null)
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null)
  const [isTestingPreview, setIsTestingPreview] = useState(false)
  const [progressNow, setProgressNow] = useState(() => Date.now())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (selectedRecord) {
      setActivePreviewIndex(0)
    }
  }, [selectedRecord])

  useEffect(() => {
    const hasTraining = records.some((record) => (record.training_status ?? 1) === 2)
    if (!hasTraining) {
      return undefined
    }
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [records])

  const handleUploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }
    let nextFiles = [...uploadFiles]
    const existingKeys = new Set(nextFiles.map((file) => `${file.name}_${file.size}_${file.lastModified}`))
    let duplicateFound = false
    for (const file of files) {
      if (nextFiles.length >= MAX_UPLOAD_FILES) {
        break
      }
      const key = `${file.name}_${file.size}_${file.lastModified}`
      if (existingKeys.has(key)) {
        duplicateFound = true
        continue
      }
      existingKeys.add(key)
      nextFiles.push(file)
    }
    let errorMessage: string | null = null
    if (duplicateFound) {
      errorMessage = copy.upload.errors.duplicate
    }
    if (nextFiles.length > MAX_UPLOAD_FILES) {
      nextFiles = nextFiles.slice(0, MAX_UPLOAD_FILES)
      errorMessage = formatTemplate(copy.upload.errors.max, { max: MAX_UPLOAD_FILES })
    }
    setUploadFiles(nextFiles)
    setUploadError(errorMessage)
    event.target.value = ""
  }

  const handleRemoveUploadFile = (index: number) => {
    setUploadFiles((previous) => previous.filter((_, idx) => idx !== index))
    setUploadError(null)
  }

  const resetUploadForm = () => {
    setUploadFiles([])
    setUploadError(null)
  }

  const handleCreateRecord = async () => {
    if (!token) {
      setUploadError(copy.upload.errors.loginRequired)
      return
    }
    if (uploadFiles.length < MIN_UPLOAD_FILES) {
      setUploadError(formatTemplate(copy.upload.errors.min, { min: MIN_UPLOAD_FILES }))
      return
    }
    if (uploadFiles.length > MAX_UPLOAD_FILES) {
      setUploadError(formatTemplate(copy.upload.errors.max, { max: MAX_UPLOAD_FILES }))
      return
    }

    setIsUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      uploadFiles.forEach((file) => formData.append("files", file))

      const response = await fetch("/api/models/lora", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.upload.errors.general)
      }
      toast({ title: copy.toasts.trainingSubmit.title, description: copy.toasts.trainingSubmit.description })
      setIsUploadOpen(false)
      resetUploadForm()
      await refetch()
    } catch (err) {
      console.error("Failed to upload model assets:", err)
      setUploadError(err instanceof Error ? err.message : copy.upload.errors.general)
    } finally {
      setIsUploading(false)
    }
  }

  const isOwner = selectedRecord && user?.username === selectedRecord.owner_user_id
  const selectedRecordStatusMeta = selectedRecord
    ? getStatusMeta(selectedRecord.training_status, copy.trainingStatus.stages)
    : null

  const selectedPreviewUrls = useMemo(() => {
    if (!selectedRecord) return []
    const entries = Array.isArray(selectedRecord.file_entries) ? selectedRecord.file_entries : []
    return entries
      .map((entry) => buildStaticImageUrl(entry))
      .filter((url): url is string => Boolean(url))
  }, [selectedRecord])

  const detailPreviewImage = useMemo(() => {
    if (!selectedRecord?.preview_entry) {
      return null
    }
    return buildStaticImageUrl(selectedRecord.preview_entry as StorageEntry | undefined)
  }, [selectedRecord])
  const detailTrainingProgress =
    selectedRecord && (selectedRecord.training_status ?? 1) === 2
      ? computeTrainingProgressInfo(selectedRecord, progressNow)
      : null
  const canTestModel =
    Boolean(selectedRecord) &&
    selectedRecord?.owner_user_id === user?.username &&
    (selectedRecord?.training_status ?? 1) === 4

  const previewUrls = useMemo(
    () =>
      uploadFiles.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
      })),
    [uploadFiles],
  )

  useEffect(() => {
    return () => {
      previewUrls.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [previewUrls])

  const handleDeleteRecord = async (record?: LoraRecord | null) => {
    const targetRecord = record ?? selectedRecord
    if (!token || !targetRecord || targetRecord.owner_user_id !== user?.username) return
    setIsDeleting(true)
    setDeletingRecordId(targetRecord.lora_id)
    setDeleteConfirmRecord(null)
    if (record) {
      setSelectedRecord(null)
    }
    try {
      const delayMs = 10000 + Math.floor(Math.random() * 3000)
      await new Promise((resolve) => setTimeout(resolve, delayMs))

      const response = await fetch(`/api/models/lora/${targetRecord.lora_id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.delete)
      }
      toast({ title: copy.toasts.deleteSuccess.title, description: copy.toasts.deleteSuccess.description })
      if (!record) {
        setSelectedRecord(null)
      }
      await refetch()
    } catch (err) {
      console.error("Failed to delete model:", err)
      toast({
        title: copy.toasts.deleteError.title,
        description: err instanceof Error ? err.message : copy.toasts.deleteError.description,
        variant: "destructive",
      })
    } finally {
      setDeletingRecordId(null)
      setIsDeleting(false)
    }
  }

  const handleTestModel = async () => {
    if (!selectedRecord) {
      return
    }
    if (!token) {
      toast({ title: copy.toasts.loginRequired.title, variant: "destructive" })
      return
    }
    if (!canTestModel) {
      toast({
        title: copy.toasts.testBlocked.title,
        description: copy.toasts.testBlocked.description,
      })
      return
    }
    setIsTestingPreview(true)
    try {
      const response = await fetch(`/api/models/lora/${selectedRecord.lora_id}/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || copy.errors.test)
      }
      const updatedRecord = data as LoraRecord
      setSelectedRecord(updatedRecord)
      toast({ title: copy.toasts.testSuccess.title, description: copy.toasts.testSuccess.description })
      await refetch()
    } catch (err) {
      console.error("Failed to test model:", err)
      toast({
        title: copy.toasts.testError.title,
        description: err instanceof Error ? err.message : copy.toasts.testError.description,
        variant: "destructive",
      })
    } finally {
      setIsTestingPreview(false)
    }
  }

  const handleOpenFilePicker = () => {
    if (uploadFiles.length >= MAX_UPLOAD_FILES) {
      setUploadError(formatTemplate(copy.upload.errors.max, { max: MAX_UPLOAD_FILES }))
      return
    }
    fileInputRef.current?.click()
  }

  const ownedModelCount = useMemo(
    () => records.filter((record) => record.owner_user_id === user?.username).length,
    [records, user?.username],
  )
  const reachedModelLimit = ownedModelCount >= 3
  const trainingCard =
    reachedModelLimit || !isAuthenticated
      ? null
      : (
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-emerald-400/40 bg-black/20 p-6 text-center text-emerald-200 transition hover:border-emerald-400 hover:bg-black/40"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-500/10 text-emerald-300">
              <Plus className="size-8" />
            </div>
            <p className="mt-4 font-serif text-2xl text-white">{copy.trainingCard.title}</p>
            <p className="mt-2 text-sm text-emerald-100/70">
              {formatTemplate(copy.trainingCard.subtitle, { min: MIN_UPLOAD_FILES, max: MAX_UPLOAD_FILES })}
            </p>
          </button>
        )

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="border-b border-white/10 bg-black/50 px-6 py-8 md:px-10">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-400">{copy.nav.badge}</p>
          <div>
            <h1 className="font-serif text-4xl text-white">{copy.nav.title}</h1>
            <p className="mt-3 text-sm text-gray-400">{copy.nav.description}</p>
          </div>
        </div>
      </div>

      <main className="px-6 py-8 md:px-10">
        {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
        {reachedModelLimit && (
          <div className="mb-4 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-xs text-yellow-100">
            {formatTemplate(copy.states.limitNotice, { limit: MODEL_LIMIT })}
          </div>
        )}
        {isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-gray-400">
            <Loader2 className="mr-2 size-5 animate-spin" />
            {copy.states.loading}
          </div>
        ) : records.length === 0 ? (
          reachedModelLimit ? (
            <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-3xl border border-yellow-500/40 bg-yellow-500/10 p-10 text-center text-yellow-100">
              <Shield className="mb-4 size-12 text-yellow-300" />
              <p className="text-lg font-semibold">
                {formatTemplate(copy.states.limitCard.title, { limit: MODEL_LIMIT })}
              </p>
              <p className="mt-2 text-sm text-yellow-100/80">{copy.states.limitCard.description}</p>
            </div>
          ) : (
            <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 p-10 text-center">
              <Layers className="mb-4 size-12 text-emerald-400" />
              <p className="text-lg text-white">{copy.states.empty.title}</p>
              <p className="mt-2 text-sm text-gray-400">
                {formatTemplate(copy.states.empty.description, { min: MIN_UPLOAD_FILES, max: MAX_UPLOAD_FILES })}
              </p>
              <div className="mt-6 w-full max-w-sm">{trainingCard}</div>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {trainingCard}
            {records.map((record) => {
              const thumbnail = buildStaticImageUrl(record.file_entries?.[0])
              const statusMeta = getStatusMeta(record.training_status, copy.trainingStatus.stages)
              const isLocked = (record.training_status ?? 1) !== 4
              const isDeletingCard = deletingRecordId === record.lora_id
              const isTrainingPhase = (record.training_status ?? 1) === 2
              const trainingProgress = isTrainingPhase ? computeTrainingProgressInfo(record, progressNow) : null
              const ownerLabel = record.owner_user_id === user?.username ? copy.cards.badges.mine : copy.cards.badges.shared
              const memberCountLabel = formatTemplate(copy.cards.memberCount, {
                count: record.access_user_ids.length,
              })
              return (
                <button
                  key={record.lora_id}
                  type="button"
                  onClick={() => {
                    if (isDeletingCard) {
                      toast({
                        title: copy.toasts.deleteInProgress.title,
                        description: copy.toasts.deleteInProgress.description,
                      })
                      return
                    }
                    if (isLocked) {
                      toast({
                        title: statusMeta.label,
                        description: statusMeta.description,
                      })
                      return
                    }
                    setSelectedRecord(record)
                  }}
                  className="group flex h-full flex-col rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4 text-left shadow-lg transition hover:border-emerald-400/50"
                >
                  <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-2xl border border-white/5 bg-black/40">
                    {thumbnail ? (
                      <div style={{ position: "relative", width: "100%", height: "100%", lineHeight: 0 }}>
                        <img src={thumbnail} alt={record.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                        <WatermarkOverlay />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-500">
                        <ImageIcon className="size-10" />
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-white">
                      {record.owner_user_id}
                    </span>
                    {isLocked && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 px-4 text-center text-white">
                        <p className="text-sm font-semibold">{statusMeta.label}</p>
                        <p className="mt-1 text-xs text-gray-200">{statusMeta.description}</p>
                        {isTrainingPhase && trainingProgress && (
                          <div className="mt-4 w-full max-w-[220px] text-left">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                              <div
                                className="h-full rounded-full bg-emerald-400 transition-all"
                                style={{ width: `${trainingProgress.percent}%` }}
                              />
                            </div>
                            <p className="mt-2 text-[11px] text-gray-200">
                              {formatTemplate(copy.trainingStatus.progressEta, {
                                minutes: trainingProgress.etaMinutes ?? 0,
                              })}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {isDeletingCard && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-4 text-center text-white">
                        <p className="text-sm font-semibold">{copy.cards.deletingOverlay}</p>
                        <div className="mt-3 h-1 w-32 overflow-hidden rounded-full bg-white/20">
                          <div className="h-full w-full animate-pulse rounded-full bg-rose-400" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <h3 className="font-serif text-xl text-white">{record.name}</h3>
                    <p className="text-xs text-gray-400">{formatDateWithLocale(record.created_at)}</p>
                    {record.description && (
                      <p className="text-sm text-gray-300 line-clamp-2">{record.description}</p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-white/20 text-[11px] uppercase tracking-[0.3em] text-white">
                      {ownerLabel}
                    </Badge>
                    {record.access_user_ids.length > 0 && (
                      <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-200">
                        <Users className="mr-1 size-3" />
                        {memberCountLabel}
                      </Badge>
                    )}
                    {isLocked && (
                      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-200">
                        {statusMeta.label}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>

      <Dialog open={isUploadOpen} onOpenChange={(open) => {
        setIsUploadOpen(open)
        if (!open) {
          resetUploadForm()
        }
      }}>
        <DialogContent className="max-w-lg border-white/10 bg-[#0E0E0E] text-white">
          <DialogHeader>
            <DialogTitle>{copy.upload.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-300">
                {copy.upload.trainingAssetsLabel}
                <span className="ml-2 text-xs text-gray-500">
                  {formatTemplate(copy.upload.countHint, { min: MIN_UPLOAD_FILES, max: MAX_UPLOAD_FILES })}
                </span>
              </label>
              <p className="mt-1 text-xs text-gray-500">{copy.upload.autoNameHint}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleUploadFiles}
              />
              <div className="mt-3 grid max-h-[320px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                {previewUrls.map((preview, index) => (
                  <div
                    key={`${preview.name}-${index}`}
                    className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/60"
                  >
                    <img src={preview.url} alt={preview.name} className="h-32 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemoveUploadFile(index)}
                      className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white/80 transition hover:bg-black hover:text-white"
                      aria-label={formatTemplate(copy.upload.removeAria, { name: preview.name })}
                    >
                      <X className="size-4" />
                    </button>
                    <p className="px-2 py-1 text-xs text-gray-300 line-clamp-1">{preview.name}</p>
                  </div>
                ))}
                {uploadFiles.length < MAX_UPLOAD_FILES && (
                  <button
                    type="button"
                    onClick={handleOpenFilePicker}
                    className="flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 text-gray-400 transition hover:border-emerald-400 hover:text-white"
                  >
                    <Plus className="size-6" />
                    <span className="mt-1 text-xs">{copy.upload.addButton}</span>
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {formatTemplate(copy.upload.selectedCount, {
                  count: uploadFiles.length,
                  max: MAX_UPLOAD_FILES,
                  remaining: Math.max(0, MAX_UPLOAD_FILES - uploadFiles.length),
                })}
              </p>
            </div>
            {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsUploadOpen(false)} className="text-gray-300 hover:text-white">
                {copy.upload.cancel}
              </Button>
              <Button onClick={() => void handleCreateRecord()} disabled={isUploading} className="bg-white text-black hover:bg-emerald-400">
                {isUploading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isUploading ? copy.upload.submitting : copy.upload.submit}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedRecord)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecord(null)
          }
        }}
      >
        <DialogContent className="w-[85vw] max-w-4xl border-white/10 bg-[#050505] text-white">
          {selectedRecord && (
            <div className="flex flex-col gap-6">
              <DialogHeader className="space-y-4 border-b border-white/5 pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle className="text-3xl font-serif text-white">{selectedRecord.name}</DialogTitle>
                  {selectedRecordStatusMeta && (
                    <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-200">
                      {selectedRecordStatusMeta.label}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em] text-gray-500">
                  <span>
                    {formatTemplate(copy.detail.createdAt, {
                      date: formatDateWithLocale(selectedRecord.created_at),
                    })}
                  </span>
                  <span className="hidden h-3 w-px bg-white/10 sm:inline-block" />
                  <span className="flex items-center gap-2 text-gray-300">
                    <Shield className="size-3" />
                    {selectedRecord.owner_user_id}
                  </span>
                </div>
              </DialogHeader>

              <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
                <div className="space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-3">
                    <div className="relative aspect-[3/2] overflow-hidden rounded-2xl bg-black/60">
                      {selectedPreviewUrls[activePreviewIndex] ? (
                        <img
                          src={selectedPreviewUrls[activePreviewIndex]}
                          alt={selectedRecord.name}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-500">
                          <ImageIcon className="size-12" />
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedPreviewUrls.length > 1 && (
                    <div className="rounded-3xl border border-white/10 bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-[0.35em] text-gray-500 mb-3">
                        {copy.detail.trainingAssets}
                      </p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {selectedPreviewUrls.map((url, index) => (
                          <button
                            key={`${selectedRecord.lora_id}-thumb-${index}`}
                            type="button"
                            onClick={() => setActivePreviewIndex(index)}
                            className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border transition ${
                              activePreviewIndex === index ? "border-emerald-400" : "border-white/10"
                            }`}
                          >
                            <img src={url} alt={`thumb-${index}`} className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {detailTrainingProgress && (
                    <div className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-white">
                      <p className="text-sm font-semibold">
                        {formatTemplate(copy.trainingStatus.detailLabel, {
                          percent: detailTrainingProgress.percent,
                        })}
                      </p>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/20">
                        <div
                          className="h-full rounded-full bg-emerald-300 transition-all"
                          style={{ width: `${detailTrainingProgress.percent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-emerald-100">
                        {formatTemplate(copy.trainingStatus.progressEta, {
                          minutes: detailTrainingProgress.etaMinutes ?? 0,
                        })}
                      </p>
                    </div>
                  )}
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                    <p className="text-xs uppercase tracking-[0.35em] text-gray-500">{copy.detail.showcase}</p>
                    <div className="mt-4 aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                      {detailPreviewImage ? (
                        <img src={detailPreviewImage} alt={copy.detail.showcase} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500">
                          <span className="text-5xl font-serif text-gray-600">?</span>
                          <p className="text-xs uppercase tracking-[0.3em]">{copy.detail.previewPlaceholder}</p>
                        </div>
                      )}
                    </div>
                    {isOwner && (
                      <div className="mt-4 space-y-2">
                        <Button
                          variant="outline"
                          onClick={() => void handleTestModel()}
                          disabled={!canTestModel || isTestingPreview}
                          className="w-full border border-emerald-500/40 bg-transparent text-emerald-200 hover:bg-emerald-500/20"
                        >
                          {isTestingPreview && <Loader2 className="mr-2 size-4 animate-spin" />}
                          {copy.detail.testButton}
                        </Button>
                        {!canTestModel && (
                          <p className="text-xs text-gray-500">{copy.detail.testDisabledHint}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {selectedRecord.description && (
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                      <p className="text-xs uppercase tracking-[0.35em] text-gray-500">{copy.detail.description}</p>
                      <p className="mt-3 text-sm text-gray-200 leading-relaxed">{selectedRecord.description}</p>
                    </div>
                  )}

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                    <p className="text-xs uppercase tracking-[0.35em] text-gray-500">{copy.detail.members}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedRecord.access_user_ids.length === 0 ? (
                        <span className="text-sm text-gray-500">{copy.detail.membersEmpty}</span>
                      ) : (
                        selectedRecord.access_user_ids.map((member) => (
                          <Badge key={member} variant="outline" className="border-white/20 text-white">
                            {member}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {isOwner && (
                    <div className="rounded-3xl border border-rose-500/40 bg-rose-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.35em] text-rose-200">{copy.detail.dangerZone}</p>
                      <Button
                        variant="destructive"
                        onClick={() => setDeleteConfirmRecord(selectedRecord)}
                        disabled={isDeleting || Boolean(deletingRecordId)}
                        className="mt-3 w-full"
                      >
                        {isDeleting && deletingRecordId === selectedRecord.lora_id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 size-4" />
                        )}
                        {copy.detail.deleteButton}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteConfirmRecord)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmRecord(null)
          }
        }}
      >
        <DialogContent className="max-w-md border-white/10 bg-[#0a0a0a] text-white">
          <DialogHeader>
            <DialogTitle>{copy.detail.deleteDialogTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-300">
            {formatTemplate(copy.detail.deleteDialogPrompt, {
              name: deleteConfirmRecord?.name || copy.detail.unnamed,
            })}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirmRecord(null)}
              className="text-gray-300 hover:text-white"
            >
              {copy.detail.deleteDialogCancel}
            </Button>
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleDeleteRecord(deleteConfirmRecord)}
              className="min-w-[120px]"
            >
              {isDeleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
              {copy.detail.deleteDialogConfirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
