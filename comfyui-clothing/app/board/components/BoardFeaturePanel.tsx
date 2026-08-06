"use client"

import { memo, useEffect, useMemo, useState } from "react"
import imageToDesignGuideImage from "./board-feature-panel-assets/image-to-design-guide.webp"
import draftToGarmentGuideImage from "./board-feature-panel-assets/draft-to-garment-guide.webp"
import lineDraftGuideImage from "./board-feature-panel-assets/line-draft-guide.webp"
import patternApplyGuideImage from "./board-feature-panel-assets/pattern-apply-guide.webp"
import seamlessPatternGuideImage from "./board-feature-panel-assets/seamless-pattern-guide.webp"
import stripeExtractionGuideImage from "./board-feature-panel-assets/stripe-extraction-guide.webp"
import textToImageGuideImage from "./board-feature-panel-assets/text-to-image-guide.webp"
import { useI18n } from "@/contexts/i18n-context"
import { IconRenderer } from "./IconRenderer"
import type { RepositoryTask } from "../types"
import {
  extractApiClient,
  type ExtractResponse,
  type PaletteGroup,
  type StripeLLMVariation,
  type StripePatternUnit,
  type TaskStatusResponse,
} from "@/lib/extract-api-client"
import { redesignApiClient } from "@/lib/redesign-api-client"

interface BoardImageOption {
  id: string
  title: string
  subtitle?: string
  url: string
}

interface BoardFeaturePanelProps {
  open: boolean
  onClose: () => void
  projectId: string
  boardImages: BoardImageOption[]
  resultTasks: RepositoryTask[]
  onRefreshResults: (projectId?: string | null) => Promise<void>
  onPlaceResultToBoard: (task: RepositoryTask) => void | Promise<void>
  onDeleteResultTasks: (taskIds: string[]) => Promise<boolean>
  onApplyBoardImageTool?: (toolId: "seamless-pattern" | "hd-upscale" | "svg-vector", assetId: string) => void
  onCreateTextToImageNode: (prompt: string) => void
  onCreateStripeExtractNode?: (assetId: string) => void
  previewImageUrl?: string | null
}

interface BoardImagePickerDialogProps {
  open: boolean
  title: string
  images: BoardImageOption[]
  selectedImageId?: string
  onClose: () => void
  onSelect: (imageId: string) => void
}

type FeatureKey =
  | "text-to-image"
  | "image-to-image"
  | "pattern-apply"
  | "seamless-pattern"
  | "hd-upscale"
  | "svg-vector"
  | "pattern-edit"
  | "extract-pattern"
  | "extract-stripe"
  | "line-draft"
  | "draft-garment"

type FeatureGroup = "new" | "image-tools" | "pattern"
type PickerMode = "single-reference" | "garment" | "pattern" | null

const EMPTY_SELECTION_ID = "__none__"
const PATTERN_APPLY_PROMPT = "将给定图案应用在服装上"
const STRIPE_EXPORT_SIZE = 1000
const STRIPE_EXPORT_REPEAT_COUNT = 5
const LINE_DRAFT_PROMPT =
  "将输入服装图片转为一张黑白技术线稿合成图，包含正面视图与背面视图（左右两部分）。白底，线稿风格，保留结构线、拼接线和关键服装细节，线条干净清晰，不要任何数字编号、箭头、文字标注或额外说明。"
const DRAFT_TO_GARMENT_PROMPT =
  "将输入线稿图转为一张完整的服装成衣效果图。保留线稿中的版型、结构和设计细节，补充合理的面料质感、颜色与真实服装光影表现，输出单件服装主体，背景干净简洁。"

const FEATURE_ITEMS: Array<{
  key: FeatureKey
  icon: string
  labelZh: string
  labelEn: string
  group: FeatureGroup
}> = [
  { key: "text-to-image", icon: "Box", labelZh: "以文生款", labelEn: "Text to Design", group: "new" },
  { key: "image-to-image", icon: "Scissors", labelZh: "以图生款", labelEn: "Image to Design", group: "new" },
  { key: "seamless-pattern", icon: "Grid2x2", labelZh: "提取无缝花型", labelEn: "Extract Seamless Pattern", group: "image-tools" },
  { key: "hd-upscale", icon: "ScanSearch", labelZh: "高清增强", labelEn: "HD Upscale", group: "image-tools" },
  { key: "svg-vector", icon: "BezierCurve", labelZh: "矢量化", labelEn: "SVG Vectorize", group: "image-tools" },
  { key: "pattern-apply", icon: "ImagePlus", labelZh: "花纹/图案上身", labelEn: "Apply Pattern", group: "pattern" },
  { key: "extract-stripe", icon: "Ruler", labelZh: "提取条纹", labelEn: "Extract Stripe", group: "pattern" },
  { key: "line-draft", icon: "PenTool", labelZh: "线稿生成", labelEn: "Line Draft", group: "pattern" },
  { key: "draft-garment", icon: "Box", labelZh: "线稿成衣", labelEn: "Draft to Garment", group: "pattern" },
]

const GROUP_LABELS: Array<{ group: FeatureGroup; labelZh: string; labelEn: string }> = [
  { group: "new", labelZh: "新款设计", labelEn: "New Design" },
  { group: "image-tools", labelZh: "图片工具", labelEn: "Image Tools" },
  { group: "pattern", labelZh: "图案设计", labelEn: "Pattern Design" },
]

const isRenderableImageUrl = (url: string | null | undefined): url is string => {
  if (!url || typeof url !== "string") return false
  const lower = url.toLowerCase()
  if (lower.startsWith("data:image/")) return true
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"].some((ext) => lower.includes(ext))
}

const isSvgUrl = (url: string | null | undefined): url is string => {
  if (!url || typeof url !== "string") return false
  const lower = url.toLowerCase()
  return lower.includes("image/svg+xml") || lower.endsWith(".svg") || lower.includes(".svg?")
}

const isTextFileUrl = (url: string | null | undefined): url is string => {
  if (!url || typeof url !== "string") return false
  const lower = url.toLowerCase()
  return lower.endsWith(".txt") || lower.includes(".txt?")
}

const parseResultTaskTime = (value: string | null | undefined) => {
  if (!value) return Number.NaN
  const normalized = value.trim().replace(/(\.\d{3})\d+/, "$1")
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const formatResultDate = (value: string | null | undefined, fallback: string) => {
  if (!value) return fallback
  const parsed = parseResultTaskTime(value)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
  }
  return value.trim().split(/[T\s]/)[0] || fallback
}

function RenderableResultImage({
  url,
  alt,
  className,
}: {
  url: string
  alt: string
  className: string
}) {
  if (isSvgUrl(url)) {
    return <SvgPreviewImage url={url} alt={alt} className={className} />
  }

  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />
}

function SvgPreviewImage({
  url,
  alt,
  className,
}: {
  url: string
  alt: string
  className: string
}) {
  const [resolvedUrl, setResolvedUrl] = useState(url)

  useEffect(() => {
    let cancelled = false

    const loadSvgPreview = async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) return
        const content = await response.text()
        if (!content.toLowerCase().includes("<svg")) return
        const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
        if (!cancelled) {
          setResolvedUrl(encoded)
        }
      } catch (error) {
        console.error("Failed to load SVG preview:", error)
      }
    }

    setResolvedUrl(url)
    void loadSvgPreview()

    return () => {
      cancelled = true
    }
  }, [url])

  return <img src={resolvedUrl} alt={alt} className={className} loading="lazy" decoding="async" />
}

const loadImageFromBlob = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(blob)
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      img.onload = null
      img.onerror = null
    }
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error("Failed to load image"))
    }
    img.src = objectUrl
  })

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

const normalizeStripeUnits = (units: StripePatternUnit[]) =>
  units
    .filter((unit) => unit && unit.color && typeof unit.widthPx === "number")
    .map((unit) => ({
      color: {
        r: clampChannel(unit.color.r),
        g: clampChannel(unit.color.g),
        b: clampChannel(unit.color.b),
      },
      widthPx: Math.max(1, Math.round(unit.widthPx)),
    }))

const scaleStripeUnitsToCycleWidth = (units: StripePatternUnit[], targetCycleWidth: number) => {
  const normalized = normalizeStripeUnits(units)
  const cycleWidth = normalized.reduce((sum, unit) => sum + unit.widthPx, 0)
  const safeTarget = Math.max(normalized.length, Math.round(targetCycleWidth))
  if (!normalized.length || cycleWidth <= 0) return []

  let usedWidth = 0
  return normalized.map((unit, index) => {
    const remainingUnits = normalized.length - index - 1
    const remainingWidth = Math.max(remainingUnits, safeTarget - usedWidth)
    const widthPx =
      index === normalized.length - 1
        ? remainingWidth
        : Math.max(1, Math.min(remainingWidth - remainingUnits, Math.round((unit.widthPx / cycleWidth) * safeTarget)))
    usedWidth += widthPx
    return { ...unit, widthPx }
  })
}

const buildStripePreviewCanvas = (units: StripePatternUnit[], width: number, height: number) => {
  if (typeof document === "undefined") return null
  if (!units.length || width <= 0 || height <= 0) return null
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const normalized = normalizeStripeUnits(units)
  const cycleWidth = normalized.reduce((sum, unit) => sum + unit.widthPx, 0)
  if (cycleWidth <= 0) return null
  const scale = canvas.width / cycleWidth
  let x = 0
  while (x < canvas.width) {
    for (const unit of normalized) {
      const drawWidth = Math.max(1, Math.round(unit.widthPx * scale))
      ctx.fillStyle = `rgb(${unit.color.r}, ${unit.color.g}, ${unit.color.b})`
      ctx.fillRect(x, 0, drawWidth, canvas.height)
      x += drawWidth
      if (x >= canvas.width) break
    }
  }
  return canvas
}

const buildStripePreviewDataUrl = (units: StripePatternUnit[], width: number, height: number) => {
  const canvas = buildStripePreviewCanvas(units, width, height)
  if (!canvas) return ""
  return canvas.toDataURL("image/png")
}

const buildStripePatternTile = (units: StripePatternUnit[]) => {
  if (typeof document === "undefined") return null
  const normalized = normalizeStripeUnits(units)
  const cycleWidth = normalized.reduce((sum, unit) => sum + unit.widthPx, 0)
  if (cycleWidth <= 0) return null
  const tile = document.createElement("canvas")
  tile.width = cycleWidth
  tile.height = cycleWidth
  const ctx = tile.getContext("2d")
  if (!ctx) return null
  let x = 0
  while (x < cycleWidth) {
    for (const unit of normalized) {
      ctx.fillStyle = `rgb(${unit.color.r}, ${unit.color.g}, ${unit.color.b})`
      ctx.fillRect(x, 0, unit.widthPx, cycleWidth)
      x += unit.widthPx
      if (x >= cycleWidth) break
    }
  }
  return tile
}

const buildStripeRotatedPreviewDataUrl = (
  units: StripePatternUnit[],
  width: number,
  height: number,
  rotation: number,
) => {
  if (typeof document === "undefined") return ""
  if (!units.length || width <= 0 || height <= 0) return ""
  const tile = buildStripePatternTile(units)
  if (!tile) return ""
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  const pattern = ctx.createPattern(tile, "repeat")
  if (!pattern) return ""
  const radians = (rotation * Math.PI) / 180
  const diag = Math.ceil(Math.sqrt(2) * Math.max(canvas.width, canvas.height))
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(radians)
  ctx.fillStyle = pattern
  ctx.fillRect(-diag / 2, -diag / 2, diag, diag)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return canvas.toDataURL("image/png")
}

const variationToUnits = (variation: StripeLLMVariation, baseWidth: number) => {
  const stripes = Array.isArray(variation.stripeUnits) ? variation.stripeUnits : []
  const total = stripes.reduce((sum, unit) => sum + Math.max(0, Number(unit.relativeWidth) || 0), 0)
  const safeTotal = total > 0 ? total : stripes.length
  return stripes.map((unit) => ({
    color: {
      r: clampChannel(unit.color?.r ?? 0),
      g: clampChannel(unit.color?.g ?? 0),
      b: clampChannel(unit.color?.b ?? 0),
    },
    widthPx: Math.max(1, Math.round(((Number(unit.relativeWidth) || 0) / safeTotal) * baseWidth)),
  }))
}

function BoardImagePickerDialog({
  open,
  title,
  images,
  selectedImageId,
  onClose,
  onSelect,
}: BoardImagePickerDialogProps) {
  const { locale } = useI18n()
  const tr = (zhText: string, enText: string) => (locale === "zh" ? zhText : enText)

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-background/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close board image picker"
      />
      <div className="relative flex max-h-[min(82vh,760px)] w-[min(1080px,82vw)] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="text-lg font-black text-foreground">{title}</div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close board image picker"
          >
            <IconRenderer name="X" size={16} />
          </button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">
          {images.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">当前画板还没有可用图片</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {images.map((item) => {
                const active = item.id === selectedImageId
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={`group overflow-hidden rounded-[1.25rem] border bg-card text-left shadow-[0_12px_30px_rgba(0,0,0,0.08)] transition-all ${
                      active ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                      <img src={item.url} alt={item.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      <div className="absolute left-3 top-3 rounded-full border border-border bg-card/92 px-2.5 py-1 text-[10px] font-black text-foreground shadow-sm">
                        画板
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-black text-foreground">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.subtitle || tr("画板图片", "Board Image")}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GuideImagePanel({ imageUrl, onPreview }: { imageUrl: string; onPreview: () => void }) {
  return (
    <div className="relative h-[calc(100%-92px)] overflow-hidden px-8 py-8">
      <div className="relative z-10 flex h-full items-center justify-center">
        <button onClick={onPreview} className="block max-h-full max-w-full">
          <img src={imageUrl} alt="设计引导" className="max-h-full max-w-full object-contain" loading="lazy" decoding="async" />
        </button>
      </div>
    </div>
  )
}

function GuideTextPanel({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="relative h-[calc(100%-92px)] overflow-hidden px-8 py-8">
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-2xl rounded-[2rem] border border-border bg-card px-10 py-12 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          <div className="text-2xl font-black text-foreground">{title}</div>
          <div className="mt-4 text-base leading-8 text-muted-foreground">{description}</div>
        </div>
      </div>
    </div>
  )
}

function ImagePreviewDialog({
  open,
  imageUrl,
  title,
  onClose,
}: {
  open: boolean
  imageUrl: string
  title: string
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
      <button className="absolute inset-0 bg-background/40 backdrop-blur-sm" onClick={onClose} aria-label="Close image preview" />
      <div className="relative flex max-h-[86vh] w-[min(1200px,88vw)] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          aria-label="Close image preview"
        >
          <IconRenderer name="X" size={16} />
        </button>
        <div className="flex-1 overflow-auto bg-background p-6">
          <img src={imageUrl} alt={title} className="mx-auto max-h-[78vh] w-auto max-w-full rounded-[1.25rem] object-contain" loading="lazy" decoding="async" />
        </div>
      </div>
    </div>
  )
}

function ResultPreviewDialog({
  task,
  onClose,
  onPlaceToBoard,
}: {
  task: RepositoryTask | null
  onClose: () => void
  onPlaceToBoard: (task: RepositoryTask) => void | Promise<void>
}) {
  if (!task) return null

  const primaryOriginalUrl = task.originalImages?.[0] ?? task.images[0] ?? ""
  const canRenderPreview = isRenderableImageUrl(primaryOriginalUrl)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
      <button className="absolute inset-0 bg-background/40 backdrop-blur-sm" onClick={onClose} aria-label="Close result preview" />
      <div className="relative flex max-h-[86vh] w-[min(1200px,88vw)] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          aria-label="Close result preview"
        >
          <IconRenderer name="X" size={16} />
        </button>

        <div className="flex-1 overflow-auto bg-background p-6">
          {canRenderPreview ? (
            <RenderableResultImage
              url={primaryOriginalUrl}
              alt={task.title}
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-[1.25rem] object-contain"
            />
          ) : (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-[1.5rem] border border-border bg-card px-8 py-16 text-center shadow-sm">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-muted">
                <IconRenderer name="FileText" size={28} className="text-muted-foreground" />
              </div>
              <div className="mt-5 text-xl font-black text-foreground">{task.title}</div>
              <div className="mt-2 text-sm text-muted-foreground">该结果是矢量文件文本内容，请在新窗口打开或下载查看。</div>
              <a
                href={primaryOriginalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-black text-primary-foreground"
              >
                打开文件
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-black text-foreground">{task.title}</div>
            <div className="text-sm text-muted-foreground">{formatResultDate(task.date, "Generated result")}</div>
          </div>
          <button
            onClick={() => void onPlaceToBoard(task)}
            className="shrink-0 rounded-full bg-primary px-6 py-3 text-sm font-black text-primary-foreground transition-transform hover:scale-[1.01]"
          >
            放置到画板
          </button>
        </div>
      </div>
    </div>
  )
}

function ImageSelectCard({
  label,
  image,
  onPick,
  onClear,
}: {
  label: string
  image: BoardImageOption | null
  onPick: () => void
  onClear: () => void
}) {
  const { locale } = useI18n()
  const tr = (zhText: string, enText: string) => (locale === "zh" ? zhText : enText)

  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-muted/50 p-4">
      <div className="mb-3 text-sm font-bold text-foreground">{label}</div>
      {image ? (
        <div className="relative overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-sm">
          <div className="relative bg-muted">
            <button onClick={onPick} className="block w-full">
              <RenderableResultImage url={image.url} alt={image.title} className="h-40 w-full object-cover" />
            </button>
            <div className="absolute left-3 top-3 rounded-full border border-border bg-card/92 px-2.5 py-1 text-[10px] font-black text-foreground shadow-sm">
              画板
            </div>
            <button
              onClick={onClear}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/92 text-muted-foreground shadow-sm transition hover:text-foreground"
              aria-label={`Clear ${label}`}
            >
              <IconRenderer name="X" size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex h-[120px] flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-border bg-background text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconRenderer name="ImagePlus" size={22} className="text-muted-foreground" />
          </div>
          <button
            onClick={onPick}
            className="mt-3 rounded-full bg-card px-5 py-2.5 text-base font-bold text-foreground shadow-sm transition-colors hover:bg-card/80"
          >
            {tr("从画板中选择", "Pick from Board")}
          </button>
        </div>
      )}
    </div>
  )
}

function BoardFeaturePanelInner({
  open,
  onClose,
  projectId,
  boardImages,
  resultTasks,
  onRefreshResults,
  onPlaceResultToBoard,
  onDeleteResultTasks,
  onApplyBoardImageTool,
  onCreateTextToImageNode,
  onCreateStripeExtractNode,
  previewImageUrl,
}: BoardFeaturePanelProps) {
  const { locale } = useI18n()
  const tr = (zhText: string, enText: string) => (locale === "zh" ? zhText : enText)
  const [activeFeature, setActiveFeature] = useState<FeatureKey>("image-to-image")
  const [activeTab, setActiveTab] = useState<"result" | "guide">("guide")
  const [pickerMode, setPickerMode] = useState<PickerMode>(null)
  const [selectedBoardImageId, setSelectedBoardImageId] = useState<string>("")
  const [selectedGarmentImageId, setSelectedGarmentImageId] = useState<string>(EMPTY_SELECTION_ID)
  const [selectedPatternImageId, setSelectedPatternImageId] = useState<string>(EMPTY_SELECTION_ID)
  const [promptText, setPromptText] = useState("")
  const [, setActiveSubmissionCount] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [taskStatusOverrides, setTaskStatusOverrides] = useState<Record<string, string>>({})
  const [recentSubmissionOrder, setRecentSubmissionOrder] = useState<Record<string, number>>({})
  const [previewingResultTask, setPreviewingResultTask] = useState<RepositoryTask | null>(null)
  const [isGuidePreviewOpen, setIsGuidePreviewOpen] = useState(false)
  const [stripeStatus, setStripeStatus] = useState<"idle" | "extracting">("idle")
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [stripeUnits, setStripeUnits] = useState<StripePatternUnit[]>([])
  const [stripePaletteGroups, setStripePaletteGroups] = useState<PaletteGroup[]>([])
  const [stripeVariations, setStripeVariations] = useState<StripeLLMVariation[]>([])
  const [stripeRotationDeg, setStripeRotationDeg] = useState(0)
  const [selectedStripeVariationIndex, setSelectedStripeVariationIndex] = useState<number | null>(null)

  const isTextToImage = activeFeature === "text-to-image"
  const isImageToImage = activeFeature === "image-to-image"
  const isPatternApply = activeFeature === "pattern-apply"
  const isSeamlessPattern = activeFeature === "seamless-pattern"
  const isHdUpscale = activeFeature === "hd-upscale"
  const isSvgVector = activeFeature === "svg-vector"
  const isExtractStripe = activeFeature === "extract-stripe"
  const isLineDraft = activeFeature === "line-draft"
  const isDraftGarment = activeFeature === "draft-garment"
  const isSingleImageBoardTool = isSeamlessPattern || isHdUpscale || isSvgVector
  const isSingleImageRedesignTool = isLineDraft || isDraftGarment

  const startSubmission = () => {
    setActiveSubmissionCount((count) => count + 1)
  }

  const finishSubmission = () => {
    setActiveSubmissionCount((count) => Math.max(0, count - 1))
  }

  const markTaskPending = (taskId: string) => {
    const now = Date.now()
    setTaskStatusOverrides((prev) => ({ ...prev, [taskId]: "PENDING" }))
    setRecentSubmissionOrder((prev) => ({ ...prev, [taskId]: now }))
  }

  const fallbackBoardImages = useMemo<BoardImageOption[]>(
    () =>
      previewImageUrl
        ? [
            {
              id: "preview-image",
              title: tr("画板图片", "Board Image"),
              subtitle: tr("最新画板图片", "Latest board image"),
              url: previewImageUrl,
            },
          ]
        : [],
    [previewImageUrl, locale],
  )

  const boardImageOptions = boardImages.length > 0 ? boardImages : fallbackBoardImages

  useEffect(() => {
    if (!selectedBoardImageId && boardImageOptions[0]?.id) {
      setSelectedBoardImageId(boardImageOptions[0].id)
    }
  }, [boardImageOptions, selectedBoardImageId])

  useEffect(() => {
    if (!open) return
    setSelectedBoardImageId(EMPTY_SELECTION_ID)
    setSelectedGarmentImageId(EMPTY_SELECTION_ID)
    setSelectedPatternImageId(EMPTY_SELECTION_ID)
  }, [open])

  useEffect(() => {
    if (activeFeature !== "image-to-image" && activeFeature !== "pattern-apply") {
      setPickerMode(null)
      setSubmitError(null)
      setSubmitMessage(null)
    }
  }, [activeFeature])

  useEffect(() => {
    if (activeFeature !== "extract-stripe") {
      setStripeError(null)
    }
  }, [activeFeature])

  const selectedBoardImage =
    selectedBoardImageId === EMPTY_SELECTION_ID
      ? null
      : boardImageOptions.find((item) => item.id === selectedBoardImageId) ?? boardImageOptions[0] ?? null

  const selectedGarmentImage =
    selectedGarmentImageId === EMPTY_SELECTION_ID
      ? null
      : boardImageOptions.find((item) => item.id === selectedGarmentImageId) ?? null

  const selectedPatternImage =
    selectedPatternImageId === EMPTY_SELECTION_ID
      ? null
      : boardImageOptions.find((item) => item.id === selectedPatternImageId) ?? null

  const sortedResultTasks = useMemo(() => {
    return [...resultTasks].sort((a, b) => {
      const aIsPending = String(taskStatusOverrides[a.id] ?? a.status ?? "").toUpperCase() === "PENDING"
      const bIsPending = String(taskStatusOverrides[b.id] ?? b.status ?? "").toUpperCase() === "PENDING"
      if (aIsPending !== bIsPending) {
        return aIsPending ? -1 : 1
      }
      const aRecent = recentSubmissionOrder[a.id] ?? -1
      const bRecent = recentSubmissionOrder[b.id] ?? -1
      if (aRecent !== bRecent) {
        return bRecent - aRecent
      }
      const aTime = parseResultTaskTime(a.date)
      const bTime = parseResultTaskTime(b.date)
      const safeA = Number.isFinite(aTime) ? aTime : -1
      const safeB = Number.isFinite(bTime) ? bTime : -1
      if (safeA !== safeB) return safeB - safeA
      const rawDateCompare = (b.date || "").localeCompare(a.date || "")
      if (rawDateCompare !== 0) return rawDateCompare
      return a.title.localeCompare(b.title, "zh-CN")
    })
  }, [recentSubmissionOrder, resultTasks, taskStatusOverrides])

  const stripePreviewUrl = useMemo(
    () => buildStripePreviewDataUrl(stripeUnits, 720, 120),
    [stripeUnits],
  )

  const stripeRotatedPreviewUrl = useMemo(
    () => buildStripeRotatedPreviewDataUrl(stripeUnits, 720, 260, stripeRotationDeg),
    [stripeRotationDeg, stripeUnits],
  )

  const stripeVariationPreviews = useMemo(
    () =>
      stripeVariations.slice(0, 4).map((variation, index) => ({
        key: `${variation.title}-${index}`,
        title: variation.title || `方案 ${index + 1}`,
        styleNote: variation.styleNote || "",
        previewUrl: buildStripePreviewDataUrl(variationToUnits(variation, 320), 320, 96),
      })),
    [stripeVariations],
  )

  const activeGuideImage = useMemo(() => {
    if (isTextToImage) {
      return textToImageGuideImage
    }
    if (isPatternApply) {
      return patternApplyGuideImage
    }
    if (isDraftGarment) {
      return draftToGarmentGuideImage
    }
    if (isLineDraft) {
      return lineDraftGuideImage
    }
    if (isExtractStripe) {
      return stripeExtractionGuideImage
    }
    if (isSeamlessPattern) {
      return seamlessPatternGuideImage
    }
    return imageToDesignGuideImage
  }, [isDraftGarment, isExtractStripe, isLineDraft, isPatternApply, isSeamlessPattern, isTextToImage])

  const activeGuideText = useMemo(() => {
    if (isHdUpscale) {
      return {
        title: tr("高清增强", "HD Upscale"),
        description: tr("将图片的分辨率处理为原来的 2x，适合在保留原图内容基础上提升清晰度。", "Upscale the image to 2x for better clarity while preserving the original content."),
      }
    }
    if (isSvgVector) {
      return {
        title: tr("矢量化", "SVG Vectorize"),
        description: tr("将图片处理为 SVG 格式，便于后续放大、编辑和矢量设计使用。", "Convert the image into SVG for later scaling, editing, and vector workflows."),
      }
    }
    return null
  }, [isHdUpscale, isSvgVector, locale])

  const panelTitle = useMemo(() => {
    if (isTextToImage) return tr("以文生款", "Text to Design")
    if (isImageToImage) return tr("以图生款", "Image to Design")
    if (isPatternApply) return tr("花纹/图案上身", "Apply Pattern")
    if (isSeamlessPattern) return tr("提取无缝花型", "Extract Seamless Pattern")
    if (isHdUpscale) return tr("高清增强", "HD Upscale")
    if (isSvgVector) return tr("矢量化", "SVG Vectorize")
    if (isExtractStripe) return tr("提取条纹", "Extract Stripe")
    if (isLineDraft) return tr("线稿生成", "Line Draft")
    if (isDraftGarment) return tr("线稿成衣", "Draft to Garment")
    return tr("设计功能", "Design Tools")
  }, [isDraftGarment, isExtractStripe, isHdUpscale, isImageToImage, isLineDraft, isPatternApply, isSeamlessPattern, isSvgVector, isTextToImage, locale])

  const pickerTitle = useMemo(() => {
    if (pickerMode === "garment") return tr("选择服装图", "Select Garment Image")
    if (pickerMode === "pattern") return tr("选择图案图", "Select Pattern Image")
    return tr("从画板中选择", "Pick from Board")
  }, [locale, pickerMode])

  const pickerSelectedImageId = useMemo(() => {
    if (pickerMode === "garment") return selectedGarmentImageId === EMPTY_SELECTION_ID ? undefined : selectedGarmentImageId
    if (pickerMode === "pattern") return selectedPatternImageId === EMPTY_SELECTION_ID ? undefined : selectedPatternImageId
    return selectedBoardImageId === EMPTY_SELECTION_ID ? undefined : selectedBoardImageId
  }, [pickerMode, selectedBoardImageId, selectedGarmentImageId, selectedPatternImageId])

  const handleGenerateImageToImage = async () => {
    if (!selectedBoardImage?.url) {
      setSubmitError("请先从画板中选择一张参考图")
      return
    }
    if (!promptText.trim()) {
      setSubmitError("请先填写改图描述")
      return
    }

    startSubmission()
    setSubmitError(null)
    setSubmitMessage("任务已提交，正在生成中")
    setActiveTab("result")
    setSelectedBoardImageId(EMPTY_SELECTION_ID)

    let tenantTaskId: string | undefined
    try {
      const submission = await redesignApiClient.submitRedesignTaskWithPoloapi({
        prompt: promptText.trim(),
        image: selectedBoardImage.url,
        projectId,
      })
      tenantTaskId = submission.tenantTaskId
      if (tenantTaskId) {
        markTaskPending(tenantTaskId as string)
      }

      await onRefreshResults(projectId)

      if (submission.tenantTaskId) {
        await redesignApiClient.waitForPoloapiTaskCompletion(submission.tenantTaskId)
        setTaskStatusOverrides((prev) => ({ ...prev, [submission.tenantTaskId as string]: "SUCCESS" }))
      }

      await onRefreshResults(projectId)
      setSubmitMessage("已生成并加入生成结果")
    } catch (error) {
      if (tenantTaskId) {
        setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "FAILED" }))
        await onRefreshResults(projectId)
      }
      console.error("Board feature image-to-image failed:", error)
      setSubmitError(error instanceof Error ? error.message : "生成失败，请稍后重试")
      setSubmitMessage(null)
    } finally {
      finishSubmission()
    }
  }

  const handleGenerateTextToImage = async () => {
    if (!promptText.trim()) {
      setSubmitError("请先填写生成描述")
      return
    }

    setSubmitError(null)
    setSubmitMessage(null)
    onCreateTextToImageNode(promptText.trim())
    onClose()
  }

  const handleGeneratePatternApply = async () => {
    if (!selectedGarmentImage?.url) {
      setSubmitError("请先选择一张服装图")
      return
    }
    if (!selectedPatternImage?.url) {
      setSubmitError("请先选择一张图案图")
      return
    }

    startSubmission()
    setSubmitError(null)
    setSubmitMessage("任务已提交，正在生成中")
    setActiveTab("result")
    setSelectedGarmentImageId(EMPTY_SELECTION_ID)
    setSelectedPatternImageId(EMPTY_SELECTION_ID)

    let tenantTaskId: string | undefined
    try {
      const submission = await redesignApiClient.submitRedesignTaskWithPoloapi({
        prompt: PATTERN_APPLY_PROMPT,
        image: selectedGarmentImage.url,
        image_2: selectedPatternImage.url,
        projectId,
      })
      tenantTaskId = submission.tenantTaskId
      if (tenantTaskId) {
        markTaskPending(tenantTaskId as string)
      }

      await onRefreshResults(projectId)

      if (submission.tenantTaskId) {
        await redesignApiClient.waitForPoloapiTaskCompletion(submission.tenantTaskId)
        setTaskStatusOverrides((prev) => ({ ...prev, [submission.tenantTaskId as string]: "SUCCESS" }))
      }

      await onRefreshResults(projectId)
      setSubmitMessage("已生成并加入生成结果")
    } catch (error) {
      if (tenantTaskId) {
        setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "FAILED" }))
        await onRefreshResults(projectId)
      }
      console.error("Board feature pattern apply failed:", error)
      setSubmitError(error instanceof Error ? error.message : "生成失败，请稍后重试")
      setSubmitMessage(null)
    } finally {
      finishSubmission()
    }
  }

  const handleGenerateFixedPromptRedesign = async () => {
    if (!selectedBoardImage?.url) {
      setSubmitError("请先从画板中选择一张参考图")
      return
    }

    const fixedPrompt = isLineDraft ? LINE_DRAFT_PROMPT : DRAFT_TO_GARMENT_PROMPT

    startSubmission()
    setSubmitError(null)
    setSubmitMessage("任务已提交，正在生成中")
    setActiveTab("result")
    setSelectedBoardImageId(EMPTY_SELECTION_ID)

    let tenantTaskId: string | undefined
    try {
      const submission = await redesignApiClient.submitRedesignTaskWithPoloapi({
        prompt: fixedPrompt,
        image: selectedBoardImage.url,
        projectId,
      })
      tenantTaskId = submission.tenantTaskId
      if (tenantTaskId) {
        markTaskPending(tenantTaskId as string)
      }

      await onRefreshResults(projectId)

      if (submission.tenantTaskId) {
        await redesignApiClient.waitForPoloapiTaskCompletion(submission.tenantTaskId)
        setTaskStatusOverrides((prev) => ({ ...prev, [submission.tenantTaskId as string]: "SUCCESS" }))
      }

      await onRefreshResults(projectId)
      setSubmitMessage("已生成并加入生成结果")
    } catch (error) {
      if (tenantTaskId) {
        setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "FAILED" }))
        await onRefreshResults(projectId)
      }
      console.error("Board feature fixed-prompt redesign failed:", error)
      setSubmitError(error instanceof Error ? error.message : "生成失败，请稍后重试")
      setSubmitMessage(null)
    } finally {
      finishSubmission()
    }
  }

  const handleApplySingleImageBoardTool = async () => {
    const selectedBoardAsset = selectedBoardImage ? boardImages.find((item) => item.id === selectedBoardImage.id) ?? null : null
    if (!selectedBoardAsset?.url) {
      setSubmitError("请先从画板中选择一张可处理的图片")
      return
    }

    if (isSvgVector) {
      if (!onApplyBoardImageTool) {
        setSubmitError("当前画板工具不可用，请稍后重试")
        return
      }
      setSubmitError(null)
      setSubmitMessage(null)
      setSelectedBoardImageId(EMPTY_SELECTION_ID)
      onApplyBoardImageTool("svg-vector", selectedBoardAsset.id)
      return
    }

    if (isSeamlessPattern) {
      if (!onApplyBoardImageTool) {
        setSubmitError("当前画板工具不可用，请稍后重试")
        return
      }
      setSubmitError(null)
      setSubmitMessage(null)
      setSelectedBoardImageId(EMPTY_SELECTION_ID)
      onApplyBoardImageTool("seamless-pattern", selectedBoardAsset.id)
      return
    }

    startSubmission()
    setSubmitError(null)
    setSubmitMessage("任务已提交，正在生成中")
    setActiveTab("result")
    setSelectedBoardImageId(EMPTY_SELECTION_ID)

    let tenantTaskId: string | undefined
    try {
      let submission
      const file =
        await (async () => {
          const response = await fetch(selectedBoardAsset.url)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
          }
          const originalBlob = await response.blob()
          const pngBlob =
            originalBlob.type === "image/png"
              ? originalBlob
              : await (async () => {
                  const image = await loadImageFromBlob(originalBlob)
                  const canvas = document.createElement("canvas")
                  canvas.width = image.naturalWidth || image.width
                  canvas.height = image.naturalHeight || image.height
                  const ctx = canvas.getContext("2d")
                  if (!ctx) {
                    throw new Error("Failed to create canvas context")
                  }
                  ctx.drawImage(image, 0, 0)
                  const pngDataUrl = canvas.toDataURL("image/png")
                  const pngResponse = await fetch(pngDataUrl)
                  return pngResponse.blob()
                })()

          return new File([pngBlob], `board-feature-${Date.now()}.png`, {
            type: "image/png",
          })
        })()

      submission = isHdUpscale
        ? await extractApiClient.submitSuperResolution(file)
        : await extractApiClient.submitSvgVectorization(file)
      tenantTaskId = submission.tenantTaskId
      if (tenantTaskId) {
        markTaskPending(tenantTaskId as string)
      }

      if (submission.tenantTaskId && projectId) {
        await extractApiClient.attachTasksToProject(projectId, [submission.tenantTaskId])
      }

      await onRefreshResults(projectId)

      let finalStatus: ExtractResponse | TaskStatusResponse = submission
      for (let i = 0; i < 300; i += 1) {
        finalStatus = await extractApiClient.getTaskStatus(submission.taskId)
        if (finalStatus.status === "SUCCESS") break
        if (finalStatus.status === "FAILED") {
          if (tenantTaskId) {
            setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "FAILED" }))
            await onRefreshResults(projectId)
          }
          throw new Error("任务处理失败")
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      if (!finalStatus || finalStatus.status !== "SUCCESS") {
        throw new Error("任务处理超时")
      }

      await extractApiClient.completeTask(submission.taskId)
      if (tenantTaskId) {
        setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "SUCCESS" }))
      }
      await onRefreshResults(projectId)
      setSubmitMessage("已生成并加入生成结果")
    } catch (error) {
      if (tenantTaskId) {
        setTaskStatusOverrides((prev) => ({ ...prev, [tenantTaskId as string]: "FAILED" }))
        await onRefreshResults(projectId)
      }
      console.error("Board feature single-image tool failed:", error)
      setSubmitError(error instanceof Error ? error.message : "处理失败，请稍后重试")
      setSubmitMessage(null)
    } finally {
      finishSubmission()
    }
  }

  const handleExtractStripe = async () => {
    const selectedBoardAsset = selectedBoardImage ? boardImages.find((item) => item.id === selectedBoardImage.id) ?? null : null
    if (!selectedBoardAsset?.url) {
      setSubmitError("请先从画板中选择一张可处理的图片")
      return
    }
    if (!onCreateStripeExtractNode) {
      setSubmitError("当前画板节点不可用，请稍后重试")
      return
    }

    setSubmitError(null)
    setSubmitMessage(null)
    setStripeError(null)
    setStripeStatus("idle")
    setStripeRotationDeg(0)
    setSelectedStripeVariationIndex(null)
    setSelectedBoardImageId(EMPTY_SELECTION_ID)
    setStripeUnits([])
    setStripePaletteGroups([])
    setStripeVariations([])
    onCreateStripeExtractNode(selectedBoardAsset.id)
  }

  const handleApplyStripeVariation = (variation: StripeLLMVariation, index: number) => {
    const units = variationToUnits(variation, 320)
    setStripeUnits(units)
    setSelectedStripeVariationIndex(index)
    setStripeError(null)
  }

  const saveStripePatternToResults = async (units: StripePatternUnit[]) => {
    if (!projectId) {
      setSubmitError("当前缺少项目信息，暂时无法保存条纹")
      return
    }
    if (!units.length) {
      setSubmitError("请先提取条纹后再保存")
      return
    }
    if (typeof document === "undefined") {
      setSubmitError("当前环境不支持保存条纹")
      return
    }

    startSubmission()
    setSubmitError(null)
    setSubmitMessage(null)

    try {
      const targetCycleWidth = STRIPE_EXPORT_SIZE / STRIPE_EXPORT_REPEAT_COUNT
      const exportUnits = scaleStripeUnitsToCycleWidth(units, targetCycleWidth)
      if (exportUnits.length === 0) {
        throw new Error("条纹数据无效，无法保存")
      }

      const tile = buildStripePatternTile(exportUnits)
      if (!tile) {
        throw new Error("生成条纹贴图失败")
      }

      const canvas = document.createElement("canvas")
      canvas.width = STRIPE_EXPORT_SIZE
      canvas.height = STRIPE_EXPORT_SIZE
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        throw new Error("生成条纹预览失败")
      }
      const pattern = ctx.createPattern(tile, "repeat")
      if (!pattern) {
        throw new Error("生成条纹预览失败")
      }

      const radians = (stripeRotationDeg * Math.PI) / 180
      const diag = Math.ceil(Math.sqrt(2) * STRIPE_EXPORT_SIZE)
      ctx.translate(STRIPE_EXPORT_SIZE / 2, STRIPE_EXPORT_SIZE / 2)
      ctx.rotate(radians)
      ctx.fillStyle = pattern
      ctx.fillRect(-diag / 2, -diag / 2, diag, diag)
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result)
            return
          }
          reject(new Error("导出条纹图片失败"))
        }, "image/png")
      })

      const file = new File([blob], `stripe-pattern-${Date.now()}.png`, { type: "image/png" })
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("token") || window.localStorage.getItem("auth_token")
          : null
      const formData = new FormData()
      formData.append("files", file, file.name)
      formData.append("description", "Saved from board feature panel stripe extractor")
      formData.append("task_type", "stripe_pattern")

      const response = await fetch(`/api/proxy/projects/${encodeURIComponent(projectId)}/uploads`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((data as { detail?: string } | null)?.detail || "保存条纹失败")
      }

      await onRefreshResults(projectId)
      setActiveTab("result")
      setSubmitMessage("条纹已保存到生成结果")
    } catch (error) {
      console.error("Board feature stripe save failed:", error)
      setSubmitError(error instanceof Error ? error.message : "保存条纹失败，请稍后重试")
      setSubmitMessage(null)
    } finally {
      finishSubmission()
    }
  }

  const handleSaveStripePattern = async () => {
    await saveStripePatternToResults(stripeUnits)
  }

  const handlePlacePreviewedResult = async (task: RepositoryTask) => {
    await onPlaceResultToBoard(task)
    setPreviewingResultTask(null)
    onClose()
  }

  const handleDeleteResultTask = async (task: RepositoryTask) => {
    const confirmed = window.confirm(`确认删除“${task.title}”吗？`)
    if (!confirmed) return
    const ok = await onDeleteResultTasks([task.id])
    if (!ok) {
      setSubmitError("删除失败，请稍后重试")
      return
    }
    setTaskStatusOverrides((prev) => {
      if (!prev[task.id]) return prev
      const next = { ...prev }
      delete next[task.id]
      return next
    })
    if (previewingResultTask?.id === task.id) {
      setPreviewingResultTask(null)
    }
  }

  const handleDownloadResultTask = async (task: RepositoryTask) => {
    const sourceUrl = task.originalImages?.[0] ?? task.images[0] ?? null
    if (!sourceUrl) {
      setSubmitError("当前结果暂无可下载内容")
      return
    }

    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch result: ${response.status}`)
      }
      const blob = await response.blob()
      const image = await loadImageFromBlob(blob)
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        throw new Error("Failed to create canvas context")
      }
      ctx.drawImage(image, 0, 0)
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result)
            return
          }
          reject(new Error("Failed to export png"))
        }, "image/png")
      })
      const objectUrl = URL.createObjectURL(pngBlob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = `${task.title || "result"}.png`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
    } catch (error) {
      console.error("Failed to download result task:", error)
      setSubmitError(error instanceof Error ? error.message : "下载失败，请稍后重试")
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-5">
      <button className="absolute inset-0 bg-background/28 backdrop-blur-sm" onClick={onClose} aria-label="Close feature panel" />

      <div className="relative h-[min(88vh,960px)] w-[min(96vw,1800px)] overflow-hidden rounded-[2rem] border border-border bg-card text-card-foreground shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          aria-label="Close feature panel"
        >
          <IconRenderer name="X" size={16} />
        </button>

        <div className="grid h-full grid-cols-[260px_410px_minmax(0,1fr)] gap-5 p-4">
          <aside className="rounded-[1.75rem] border border-border bg-background px-4 py-6">
            <div className="space-y-6">
              {GROUP_LABELS.map(({ group, labelZh, labelEn }) => (
                <div key={group} className="space-y-2">
                  <div className="px-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {tr(labelZh, labelEn)}
                  </div>
                  <div className="space-y-1">
                    {FEATURE_ITEMS.filter((item) => item.group === group).map((item) => {
                      const active = item.key === activeFeature
                      return (
                        <button
                          key={item.key}
                          onClick={() => setActiveFeature(item.key)}
                          className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                            active
                              ? "bg-muted text-foreground shadow-sm ring-1 ring-border"
                              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          }`}
                        >
                          <IconRenderer name={item.icon} size={18} className={active ? "text-primary" : "text-muted-foreground"} />
                          <span className="text-sm font-bold">{tr(item.labelZh, item.labelEn)}</span>
                          <IconRenderer name="ChevronRight" size={16} className={`ml-auto ${active ? "text-primary" : "text-muted-foreground/60"}`} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background px-6 py-6">
            <div className="shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1 rounded-full bg-primary" />
                <h2 className="text-[2rem] font-black tracking-tight text-foreground">{panelTitle}</h2>
              </div>
              <button
                onClick={() => {
                  setPromptText("")
                  setSubmitError(null)
                  setSubmitMessage(null)
                }}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Reset feature form"
              >
                <IconRenderer name="History" size={18} />
              </button>
            </div>

            <div className="mt-8 min-h-0 flex-1 overflow-y-auto pr-1">
            {isTextToImage ? (
              <div>
                <div className="text-lg font-bold text-foreground">文本描述</div>
                <textarea
                  className="mt-4 h-32 w-full resize-none rounded-[1.25rem] border border-border bg-muted px-5 py-4 text-base text-foreground outline-none transition focus:border-ring focus:bg-card"
                  placeholder="例如：春夏轻运动女装套装，偏年轻化，面料轻薄，配色清爽。"
                  value={promptText}
                  onChange={(event) => setPromptText(event.target.value)}
                />
              </div>
            ) : isImageToImage ? (
              <>
                <div className="mt-8">
                  <ImageSelectCard
                    label="参考图"
                    image={selectedBoardImage}
                    onPick={() => setPickerMode("single-reference")}
                    onClear={() => setSelectedBoardImageId(EMPTY_SELECTION_ID)}
                  />
                </div>

                <div className="mt-8">
                  <div className="text-lg font-bold text-foreground">改图描述</div>
                  <textarea
                    className="mt-4 h-32 w-full resize-none rounded-[1.25rem] border border-border bg-muted px-5 py-4 text-base text-foreground outline-none transition focus:border-ring focus:bg-card"
                    placeholder="例如：保留服装结构，改成更年轻的运动机能风，面料更轻薄，颜色调整为灰蓝色。"
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value)}
                  />
                </div>
              </>
            ) : isPatternApply ? (
              <>
                <div className="mt-8 grid grid-cols-1 gap-5">
                  <ImageSelectCard
                    label="服装图"
                    image={selectedGarmentImage}
                    onPick={() => setPickerMode("garment")}
                    onClear={() => setSelectedGarmentImageId(EMPTY_SELECTION_ID)}
                  />
                  <ImageSelectCard
                    label="图案图"
                    image={selectedPatternImage}
                    onPick={() => setPickerMode("pattern")}
                    onClear={() => setSelectedPatternImageId(EMPTY_SELECTION_ID)}
                  />
                </div>
              </>
            ) : isSingleImageBoardTool ? (
              <div className="mt-8">
                <ImageSelectCard
                  label="参考图"
                  image={selectedBoardImage}
                  onPick={() => setPickerMode("single-reference")}
                  onClear={() => setSelectedBoardImageId(EMPTY_SELECTION_ID)}
                />
              </div>
            ) : isSingleImageRedesignTool ? (
              <div className="mt-8">
                <ImageSelectCard
                  label={isLineDraft ? "服装图" : "线稿图"}
                  image={selectedBoardImage}
                  onPick={() => setPickerMode("single-reference")}
                  onClear={() => setSelectedBoardImageId(EMPTY_SELECTION_ID)}
                />
              </div>
            ) : isExtractStripe ? (
              <div className="space-y-6">
                <ImageSelectCard
                  label="参考图"
                  image={selectedBoardImage}
                  onPick={() => setPickerMode("single-reference")}
                  onClear={() => setSelectedBoardImageId(EMPTY_SELECTION_ID)}
                />

                {stripePreviewUrl ? (
                  <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black text-foreground">提取结果</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleSaveStripePattern()}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-[1.03]"
                          aria-label="Save stripe result"
                        >
                          <IconRenderer name="Download" size={15} />
                        </button>
                        <button
                          onClick={() => setStripeRotationDeg(0)}
                          className="rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          重置角度
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-[1rem] border border-border bg-muted">
                      <img src={stripePreviewUrl} alt="条纹提取结果" className="h-24 w-full object-cover" />
                    </div>
                    {stripeRotatedPreviewUrl ? (
                      <div className="mt-4 overflow-hidden rounded-[1rem] border border-border bg-muted">
                        <img src={stripeRotatedPreviewUrl} alt="条纹旋转预览" className="h-48 w-full object-cover" />
                      </div>
                    ) : null}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                        <span>旋转预览</span>
                        <span>{Math.round(stripeRotationDeg)}°</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={stripeRotationDeg}
                        onChange={(event) => setStripeRotationDeg(Number(event.target.value) || 0)}
                        className="mt-3 w-full"
                      />
                    </div>
                  </div>
                ) : null}

                {stripeVariationPreviews.length > 0 ? (
                  <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
                    <div className="text-sm font-black text-foreground">条纹变体</div>
                    <div className="mt-4 grid grid-cols-1 gap-3">
                      {stripeVariationPreviews.map((variation, index) => (
                        <button
                          key={variation.key}
                          onClick={() => handleApplyStripeVariation(stripeVariations[index], index)}
                          className={`relative overflow-hidden rounded-[1rem] border bg-background text-left transition-all ${
                            selectedStripeVariationIndex === index
                              ? "border-primary ring-2 ring-primary/25"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <div className="absolute right-3 top-3 z-10">
                            <button
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                void saveStripePatternToResults(variationToUnits(stripeVariations[index], 720))
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-[1.03]"
                              aria-label={`Save ${variation.title}`}
                            >
                              <IconRenderer name="Download" size={15} />
                            </button>
                          </div>
                          <div className="h-24 overflow-hidden bg-muted">
                            <img src={variation.previewUrl} alt={variation.title} className="h-full w-full object-cover" />
                          </div>
                          <div className="p-3">
                            <div className="text-sm font-black text-foreground">{variation.title}</div>
                            {variation.styleNote ? <div className="mt-1 text-xs text-muted-foreground">{variation.styleNote}</div> : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {stripeStatus === "extracting" ? (
                  <div className="text-sm font-medium text-muted-foreground">正在分析条纹结构并生成变体…</div>
                ) : null}
                {stripeError ? <div className="text-sm font-medium text-destructive">{stripeError}</div> : null}

              </div>
            ) : (
              <div>
                <div className="rounded-[1.25rem] border border-border bg-muted px-5 py-5 text-sm leading-7 text-muted-foreground">
                  当前功能面板仍在补充中。
                </div>
              </div>
            )}
            </div>

            <div className="shrink-0 mt-6 space-y-5 pt-4">
              {submitError ? <div className="text-sm font-medium text-destructive">{submitError}</div> : null}
              {submitMessage ? <div className="text-sm font-medium text-emerald-600">{submitMessage}</div> : null}
              <button
                onClick={() => {
                  if (isTextToImage) {
                    void handleGenerateTextToImage()
                    return
                  }
                  if (isImageToImage) {
                    void handleGenerateImageToImage()
                    return
                  }
                  if (isPatternApply) {
                    void handleGeneratePatternApply()
                    return
                  }
                  if (isSingleImageRedesignTool) {
                    void handleGenerateFixedPromptRedesign()
                    return
                  }
                  if (isSingleImageBoardTool) {
                    void handleApplySingleImageBoardTool()
                    return
                  }
                  if (isExtractStripe) {
                    void handleExtractStripe()
                    return
                  }
                  setSubmitError(
                    tr(
                      "当前只有“以图生款”、“线稿生成”、“线稿成衣”、“提取无缝花型”、“高清增强”、“矢量化”、“花纹/图案上身”和“提取条纹”已接入真实功能",
                      "Only \"Image to Design\", \"Line Draft\", \"Draft to Garment\", \"Extract Seamless Pattern\", \"HD Upscale\", \"SVG Vectorize\", \"Apply Pattern\", and \"Extract Stripe\" are wired to real functionality.",
                    ),
                  )
                }}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-primary text-lg font-black text-primary-foreground transition-transform hover:scale-[1.01]"
              >
                {isTextToImage
                  ? tr("放置到画板", "Place on Board")
                  : isSingleImageBoardTool || isExtractStripe
                    ? tr("开始处理", "Start")
                    : tr("生成", "Generate")}
              </button>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[1.75rem] border border-border bg-background">
            <div className="border-b border-border bg-card px-10 pt-6">
              <div className="flex items-end gap-10">
                <button
                  onClick={() => setActiveTab("result")}
                  className={`border-b-[3px] pb-4 text-[1.35rem] font-bold transition-colors ${
                    activeTab === "result" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
                  }`}
                >
                  {tr("生成结果", "Results")}
                </button>
                <button
                  onClick={() => setActiveTab("guide")}
                  className={`border-b-[3px] pb-4 text-[1.35rem] font-bold transition-colors ${
                    activeTab === "guide" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
                  }`}
                >
                  {tr("设计引导", "Guide")}
                </button>
              </div>
            </div>

            {activeTab === "result" ? (
              <div className="h-[calc(100%-92px)] overflow-y-auto overflow-x-hidden px-8 py-8">
                {sortedResultTasks.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-muted-foreground">
                    <div>
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-card shadow-sm">
                        <IconRenderer name="ImagePlus" size={26} className="text-muted-foreground" />
                      </div>
                      <div className="mt-4 text-lg font-bold text-foreground">{tr("还没有生成结果", "No results yet")}</div>
                      <div className="mt-2 text-sm">
                        {tr("提交任务后，结果会出现在这里，不会自动加入画板。", "Submitted tasks will appear here and will not be added to the board automatically.")}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid justify-start gap-5" style={{ gridTemplateColumns: "repeat(5, 172px)" }}>
                    {sortedResultTasks.map((task) => {
                      const preview = task.images[0] ?? task.originalImages?.[0] ?? null
                      const effectiveStatus = String(taskStatusOverrides[task.id] ?? task.status ?? "").toUpperCase()
                      const isFailed = effectiveStatus === "FAILED" || effectiveStatus === "ERROR"
                      const canRenderPreview = isRenderableImageUrl(preview)
                      const isTextResult = isTextFileUrl(task.originalImages?.[0] ?? task.images[0] ?? null)
                      return (
                        <div
                          key={task.id}
                          className="group shrink-0 overflow-hidden rounded-[1.1rem] border border-border bg-card shadow-[0_12px_30px_rgba(0,0,0,0.1)] transition-transform hover:-translate-y-0.5"
                          style={{ width: 172, minWidth: 172, maxWidth: 172, flex: "0 0 172px" }}
                        >
                          <button
                            onClick={() => {
                              if (isTextResult && task.originalImages?.[0]) {
                                window.open(task.originalImages[0], "_blank", "noopener,noreferrer")
                                return
                              }
                              setPreviewingResultTask(task)
                            }}
                            className="relative block w-full overflow-hidden bg-muted text-left"
                            style={{ width: 172, height: 216 }}
                          >
                            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                              <button
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  void handleDownloadResultTask(task)
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/92 text-muted-foreground shadow-sm transition hover:text-foreground"
                                aria-label={`Download ${task.title}`}
                              >
                                <IconRenderer name="Download" size={14} />
                              </button>
                              <button
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  void handleDeleteResultTask(task)
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/92 text-muted-foreground shadow-sm transition hover:text-destructive"
                                aria-label={`Delete ${task.title}`}
                              >
                                <IconRenderer name="X" size={14} />
                              </button>
                            </div>
                            {isFailed ? (
                              <div className="flex h-full items-center justify-center bg-gradient-to-br from-rose-50 to-red-50 text-red-700">
                                <div className="text-center">
                                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-red-200 bg-white shadow-sm">
                                    <IconRenderer name="CircleAlert" size={24} className="text-red-500" />
                                  </div>
                                  <div className="mt-4 text-sm font-black">任务失败</div>
                                  <div className="mt-1 text-xs text-red-500">请重新提交</div>
                                </div>
                              </div>
                            ) : preview && canRenderPreview ? (
                              <RenderableResultImage
                                url={preview}
                                alt={task.title}
                                className="h-full w-full object-cover"
                              />
                            ) : isTextResult ? (
                              <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50 text-slate-700">
                                <div className="text-center">
                                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-slate-200 bg-white shadow-sm">
                                    <IconRenderer name="FileText" size={24} className="text-slate-500" />
                                  </div>
                                  <div className="mt-4 text-sm font-black">TXT Vector</div>
                                  <div className="mt-1 text-xs text-slate-500">点击打开文件</div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center text-muted-foreground">
                                <div className="text-center">
                                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-card shadow-sm">
                                    <IconRenderer name="Loader2" size={26} className="text-muted-foreground" />
                                  </div>
                                  <div className="mt-4 text-sm font-bold">任务处理中</div>
                                </div>
                              </div>
                            )}
                          </button>
                          <div className="p-3">
                            <div className="line-clamp-2 text-sm font-black text-foreground">{task.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{formatResultDate(task.date, "Pending")}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : activeGuideText ? (
              <GuideTextPanel title={activeGuideText.title} description={activeGuideText.description} />
            ) : (
              <GuideImagePanel imageUrl={activeGuideImage.src} onPreview={() => setIsGuidePreviewOpen(true)} />
            )}
          </section>
        </div>

        <BoardImagePickerDialog
          open={pickerMode !== null}
          title={pickerTitle}
          images={boardImageOptions}
          selectedImageId={pickerSelectedImageId}
          onClose={() => setPickerMode(null)}
          onSelect={(imageId) => {
            if (pickerMode === "garment") {
              setSelectedGarmentImageId(imageId)
            } else if (pickerMode === "pattern") {
              setSelectedPatternImageId(imageId)
            } else {
              setSelectedBoardImageId(imageId)
            }
            setPickerMode(null)
          }}
        />

        <ResultPreviewDialog
          task={previewingResultTask}
          onClose={() => setPreviewingResultTask(null)}
          onPlaceToBoard={handlePlacePreviewedResult}
        />

        {!activeGuideText ? (
          <ImagePreviewDialog
            open={isGuidePreviewOpen}
            imageUrl={activeGuideImage.src}
            title={tr("设计引导", "Guide")}
            onClose={() => setIsGuidePreviewOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}

export const BoardFeaturePanel = memo(BoardFeaturePanelInner)
