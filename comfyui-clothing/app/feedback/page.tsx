"use client"

import type { ChangeEvent, FormEvent } from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Film, ImageIcon, Loader2, MessageSquare, Paperclip, Sparkles, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"

type FeedbackAttachment = {
  name?: string | null
  contentType?: string | null
  fileType?: string | null
  kind?: "image" | "video"
  originalUrl?: string | null
  thumbnailUrl?: string | null
}

type FeedbackItem = {
  id?: number | string | null
  tenantId?: number | null
  userId?: number | null
  username?: string | null
  content?: string | null
  createdAt?: string | null
  rewardPoints?: number
  rewardedAt?: string | null
  rewardGranted?: boolean
  attachments?: FeedbackAttachment[]
}

type FeedbackSummary = {
  monthlyRewardLimit: number
  rewardPointsPerFeedback: number
  rewardedThisMonth: number
  remainingRewardSlots: number
}

type PendingFile = {
  id: string
  file: File
  kind: "image" | "video"
}

type FeedbackResponse = {
  monthlyRewardLimit?: number
  rewardPointsPerFeedback?: number
  rewardedThisMonth?: number
  remainingRewardSlots?: number
  rewardGranted?: boolean
  isAdminView?: boolean
  items?: FeedbackItem[]
  item?: FeedbackItem
  detail?: string
}

const FALLBACK_COPY = {
  title: "Product Feedback",
  adminTitle: "Feedback inbox",
  description: "Share suggestions for the site, workflows, or missing capabilities.",
  adminDescription: "Review all feedback in the same route. Reward points still follow the monthly cap.",
  contentLabel: "Suggestion",
  contentPlaceholder: "Describe the issue, friction point, or feature idea you want us to improve.",
  attachmentsLabel: "Attachments",
  attachmentsHint: "Attach screenshots, recordings, or short videos to add context.",
  attachmentActionLabel: "Add attachment",
  submitLabel: "Submit feedback",
  submittingLabel: "Submitting...",
  successDialogActionLabel: "Got it",
  summaryTitle: "Monthly reward status",
  summaryHint: "Each account can earn 500 points up to 3 times per calendar month.",
  rewardedThisMonthLabel: "Rewarded this month",
  remainingLabel: "Reward slots left",
  rewardPointsLabel: "Points per reward",
  monthlyLimitLabel: "Monthly limit",
  rewardCapNotice: "You can still submit feedback this month, but no further points will be granted.",
  recentTitle: "Recent feedback",
  adminRecentTitle: "All feedback",
  recentDescription: "Your most recent feedback appears here.",
  adminRecentDescription: "All feedback within your current permission scope appears here.",
  emptyState: "No feedback submitted yet.",
  emptyAdminState: "No feedback records yet.",
  submittedByLabel: "Submitted by",
  rewardedAtLabel: "Rewarded at",
  adminViewBadge: "Admin view",
  rewardedBadge: "Rewarded",
  noRewardBadge: "No reward",
  pointsUnit: "pts",
  removeFileLabel: "Remove",
  successTitle: "Feedback submitted",
  successDescription: "Thanks. Your feedback has been recorded.",
  rewardSuccessDescription: "Thanks. 500 points have been added to your account.",
  rewardUnavailableDescription: "Thanks. Your feedback was recorded, but this month’s reward quota is already used.",
  errors: {
    loginRequired: "Please log in first.",
    contentRequired: "Please enter your feedback before submitting.",
    requestFailed: "Unable to submit feedback right now.",
    invalidFileType: "Only image and video files are supported.",
  },
} as const

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function feedbackItemKey(item: FeedbackItem) {
  return `${item.id ?? "feedback"}-${item.createdAt ?? ""}-${item.userId ?? ""}`
}

function normalizeRewardPoints(value: number | string | null | undefined) {
  const parsed = typeof value === "string" ? Number(value) : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function FeedbackPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user, isAuthenticated, isLoading, token } = useAuth()
  const { messages } = useI18n()
  const copy = messages.feedback || FALLBACK_COPY
  const isAdmin = user?.group === 1000

  const [content, setContent] = useState("")
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([])
  const [summary, setSummary] = useState<FeedbackSummary>({
    monthlyRewardLimit: 3,
    rewardPointsPerFeedback: 500,
    rewardedThisMonth: 0,
    remainingRewardSlots: 3,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return
    }

    let ignore = false

    const loadFeedback = async () => {
      setIsLoadingFeedback(true)
      try {
        const headers = token && token !== "__cookie__" ? { Authorization: `Bearer ${token}` } : undefined
        const response = await fetch("/api/feedback", {
          method: "GET",
          headers,
        })
        const data = (await response.json().catch(() => null)) as FeedbackResponse | null
        if (!response.ok) {
          throw new Error(data?.detail || copy.errors.requestFailed)
        }

        if (ignore || !data) {
          return
        }

        setSummary({
          monthlyRewardLimit: typeof data.monthlyRewardLimit === "number" ? data.monthlyRewardLimit : 3,
          rewardPointsPerFeedback: typeof data.rewardPointsPerFeedback === "number" ? data.rewardPointsPerFeedback : 500,
          rewardedThisMonth: typeof data.rewardedThisMonth === "number" ? data.rewardedThisMonth : 0,
          remainingRewardSlots: typeof data.remainingRewardSlots === "number" ? data.remainingRewardSlots : 0,
        })
        setFeedbackItems(Array.isArray(data.items) ? data.items : [])
        setErrorMessage(null)
      } catch (error) {
        if (!ignore) {
          const message = error instanceof Error ? error.message : copy.errors.requestFailed
          setErrorMessage(message)
          toast({
            title: copy.errors.requestFailed,
            description: message,
            variant: "destructive",
          })
        }
      } finally {
        if (!ignore) {
          setIsLoadingFeedback(false)
        }
      }
    }

    void loadFeedback()
    return () => {
      ignore = true
    }
  }, [copy.errors.requestFailed, isAuthenticated, isLoading, token, toast])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || [])
    if (selectedFiles.length === 0) {
      return
    }

    const nextFiles: PendingFile[] = []
    for (const file of selectedFiles) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        toast({
          title: copy.errors.invalidFileType,
          variant: "destructive",
        })
        continue
      }
      const kind = file.type.startsWith("video/") ? "video" : "image"
      nextFiles.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        kind,
      })
    }

    if (nextFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...nextFiles].slice(0, 6))
    }

    event.target.value = ""
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      return prev.filter((item) => item.id !== id)
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isAuthenticated) {
      toast({
        title: copy.errors.loginRequired,
        variant: "destructive",
      })
      return
    }

    if (!content.trim()) {
      toast({
        title: copy.errors.contentRequired,
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append("content", content.trim())
      pendingFiles.forEach((item) => {
        formData.append("files", item.file, item.file.name)
      })

      const headers = token && token !== "__cookie__" ? { Authorization: `Bearer ${token}` } : undefined
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: formData,
      })
      const data = (await response.json().catch(() => null)) as FeedbackResponse | null

      if (!response.ok) {
        throw new Error(data?.detail || copy.errors.requestFailed)
      }

      const updatedSummary = {
        monthlyRewardLimit: typeof data?.monthlyRewardLimit === "number" ? data.monthlyRewardLimit : summary.monthlyRewardLimit,
        rewardPointsPerFeedback:
          typeof data?.rewardPointsPerFeedback === "number" ? data.rewardPointsPerFeedback : summary.rewardPointsPerFeedback,
        rewardedThisMonth: typeof data?.rewardedThisMonth === "number" ? data.rewardedThisMonth : summary.rewardedThisMonth,
        remainingRewardSlots:
          typeof data?.remainingRewardSlots === "number" ? data.remainingRewardSlots : summary.remainingRewardSlots,
      }
      setSummary(updatedSummary)

      if (data?.item) {
        setFeedbackItems((prev) => {
          return [data.item as FeedbackItem, ...prev.filter((item) => feedbackItemKey(item) !== feedbackItemKey(data.item as FeedbackItem))]
        })
      }

      setContent("")
      setPendingFiles((prev) => {
        return []
      })
      setErrorMessage(null)

      setSuccessDialogOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.errors.requestFailed
      setErrorMessage(message)
      toast({
        title: copy.errors.requestFailed,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading || isLoadingFeedback) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  const visibleItems = feedbackItems
  const containerClassName = isAdmin ? "mx-auto max-w-5xl space-y-6" : "w-full max-w-3xl space-y-6"

  return (
    <main
      className={
        isAdmin
          ? "min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-10"
          : "flex min-h-screen items-center justify-center bg-background px-4 py-6 sm:px-6 lg:px-10"
      }
    >
      <div className={containerClassName}>
        {isAdmin ? (
          <section className="rounded-[28px] border border-border/70 bg-background/90 p-6 shadow-sm backdrop-blur md:p-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
                <MessageSquare className="size-3.5" />
                {copy.adminTitle}
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{copy.adminTitle}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.adminDescription}</p>

              <div className="mt-5 flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full px-3 py-1">
                  <Sparkles className="mr-2 size-3.5" />
                  {summary.rewardedThisMonth}/{summary.monthlyRewardLimit} {copy.pointsUnit}
                </Badge>
              </div>
            </div>
          </section>
        ) : null}

        {errorMessage ? (
          <section className="rounded-[24px] border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {errorMessage}
          </section>
        ) : null}

        <section className="rounded-[28px] border border-border/70 bg-background/95 p-8 shadow-sm">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-3 rounded-3xl border border-border/70 bg-card/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Paperclip className="size-4" />
                    {copy.attachmentsLabel}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{copy.attachmentsHint}</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 self-start rounded-full border border-dashed border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-foreground/20 hover:bg-muted/60">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Paperclip className="size-4" />
                  {copy.attachmentActionLabel}
                </label>
              </div>

              {pendingFiles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((item) => (
                    <div
                      key={item.id}
                      className="flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-foreground"
                    >
                      {item.kind === "video" ? (
                        <Film className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="max-w-[180px] truncate sm:max-w-[240px]">{item.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(item.id)}
                        className="ml-1 rounded-full p-0.5 text-muted-foreground transition hover:text-foreground"
                        aria-label={copy.removeFileLabel}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">{copy.contentLabel}</label>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={copy.contentPlaceholder}
                className="min-h-[340px] rounded-2xl border-border/80 bg-card px-4 py-3 text-base leading-6"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {summary.remainingRewardSlots <= 0 ? (
                <p className="text-xs leading-6 text-muted-foreground">{copy.rewardCapNotice}</p>
              ) : null}
              <Button type="submit" disabled={isSubmitting} className="rounded-full px-6 sm:self-end">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {copy.submittingLabel}
                  </>
        ) : (
          copy.submitLabel
        )}
      </Button>
    </div>
  </form>
</section>

        <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-[28px] border-border/70 bg-background p-0 overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-50 via-background to-background px-6 pb-5 pt-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                {copy.successTitle}
              </div>
              <DialogHeader className="mt-4 text-left">
                <DialogTitle className="text-2xl text-foreground">{copy.successTitle}</DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                  {copy.successDescription}
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter className="px-6 pb-6">
              <DialogClose asChild>
                <Button type="button" className="rounded-full px-5">
                  {copy.successDialogActionLabel}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isAdmin ? (
          <section className="rounded-[28px] border border-border/70 bg-background/95 p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">{copy.adminRecentTitle}</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.adminRecentDescription}</p>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {visibleItems.length}
              </Badge>
            </div>

            {visibleItems.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card/60 px-5 py-10 text-sm text-muted-foreground">
                {copy.emptyAdminState}
              </div>
            ) : (
              <div className="space-y-4">
                {visibleItems.map((item) => {
                  const rewardPoints = normalizeRewardPoints(item.rewardPoints)
                  const rewardGranted = Boolean(item.rewardGranted) || rewardPoints > 0
                  return (
                    <article key={feedbackItemKey(item)} className="rounded-[24px] border border-border bg-card/80 p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">
                              {`${copy.submittedByLabel}: ${item.username || "—"}`}
                            </h3>
                            <Badge variant={rewardGranted ? "secondary" : "outline"} className="rounded-full px-3 py-1">
                              {rewardGranted ? `+${rewardPoints || summary.rewardPointsPerFeedback} ${copy.pointsUnit}` : `0 ${copy.pointsUnit}`}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(item.createdAt)}
                            {rewardGranted && item.rewardedAt ? ` · ${copy.rewardedAtLabel}: ${formatDateTime(item.rewardedAt)}` : ""}
                          </p>
                        </div>
                        {rewardGranted ? (
                          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                            <Sparkles className="size-3.5" />
                            {copy.rewardedBadge}
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                            {copy.noRewardBadge}
                          </div>
                        )}
                      </div>

                      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground">
                        {item.content || "—"}
                      </p>

                      {item.attachments && item.attachments.length > 0 ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {item.attachments.map((attachment, index) => {
                            const attachmentKey = `${feedbackItemKey(item)}-${index}`
                            const previewUrl =
                              attachment.kind === "video"
                                ? attachment.originalUrl || attachment.thumbnailUrl || ""
                                : attachment.thumbnailUrl || attachment.originalUrl || ""
                            return (
                              <div key={attachmentKey} className="overflow-hidden rounded-2xl border border-border bg-background">
                                <div className="aspect-[4/3] bg-muted">
                                  {attachment.kind === "video" ? (
                                    <video src={previewUrl} controls className="h-full w-full object-cover" />
                                  ) : (
                                    <img
                                      src={previewUrl}
                                      alt={attachment.name || "attachment"}
                                      className="h-full w-full object-cover"
                                    />
                                  )}
                                </div>
                                <div className="px-4 py-3">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {attachment.name || "attachment"}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {attachment.contentType || attachment.fileType || attachment.kind || "file"}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
}
