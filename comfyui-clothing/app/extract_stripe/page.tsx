"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { PaintBucket, Sparkles, AlertTriangle, Ruler, X, ZoomIn, RefreshCw, ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { extractApiClient, type PaletteGroup, type StripePatternUnit, type StripeLLMVariation } from "@/lib/extract-api-client"

const STRIPE_STORAGE_KEY = "extract_stripe_payload"
const MAX_SESSION_PAYLOAD_BYTES = 2 * 1024 * 1024

interface StripePayload {
  stripePatternUnit: StripePatternUnit[]
  paletteGroups?: PaletteGroup[]
  sourceImage?: string | null
  generatedAt?: number
}

interface EditableStripeUnit extends StripePatternUnit {
  id: string
}

type StripeUnitSnapshot = Omit<EditableStripeUnit, "id">

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`

const hexToRgb = (hex: string) => {
  const normalised = hex.replace("#", "")
  const value = Number.parseInt(normalised.length === 3 ? normalised.repeat(2) : normalised, 16)
  if (Number.isNaN(value)) return { r: 0, g: 0, b: 0 }
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  const delta = max - min
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / delta + 2
        break
      case b:
      default:
        h = (r - g) / delta + 4
        break
    }
    h /= 6
  }
  return { h: h * 360, s, l }
}

const hslToRgb = (h: number, s: number, l: number) => {
  const hueToRgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const normalizedH = ((h % 360) + 360) % 360 / 360
  let r = l
  let g = l
  let b = l
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hueToRgb(p, q, normalizedH + 1 / 3)
    g = hueToRgb(p, q, normalizedH)
    b = hueToRgb(p, q, normalizedH - 1 / 3)
  }
  return {
    r: clampChannel(Math.round(r * 255)),
    g: clampChannel(Math.round(g * 255)),
    b: clampChannel(Math.round(b * 255)),
  }
}

const applyHueShift = (color: { r: number; g: number; b: number }, shift: number) => {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b)
  return hslToRgb(h + shift, s, l)
}

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

const createStripeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `stripe-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("无法读取图片，请稍后重试。"))
    reader.readAsDataURL(file)
  })

export default function ExtractStripePage() {
  const [stripeUnits, setStripeUnits] = useState<EditableStripeUnit[]>([])
  const [paletteGroups, setPaletteGroups] = useState<PaletteGroup[]>([])
  const [payloadMeta, setPayloadMeta] = useState<{ generatedAt?: number; sourceImage?: string | null }>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null)
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(null)
  const [isAnalyzingSource, setIsAnalyzingSource] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isReextracting, setIsReextracting] = useState(false)
  const [reextractError, setReextractError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedStripeId, setSelectedStripeId] = useState<string | null>(null)
  const [editingStripeId, setEditingStripeId] = useState<string | null>(null)
  const [draggingStripeId, setDraggingStripeId] = useState<string | null>(null)
  const dragOverIdRef = useRef<string | null>(null)
  const [basePatternPreviewUrl, setBasePatternPreviewUrl] = useState<string | null>(null)
  const [previewLightbox, setPreviewLightbox] = useState<{ src: string; title: string } | null>(null)
  const [aiVariations, setAiVariations] = useState<StripeLLMVariation[]>([])
  const [aiError, setAiError] = useState<string | null>(null)
  const [isLoadingAiVariations, setIsLoadingAiVariations] = useState(false)
  const [rotationAngle, setRotationAngle] = useState(0)
  const [copiedStripe, setCopiedStripe] = useState<StripeUnitSnapshot | null>(null)
  const aiRequestSignatureRef = useRef<string>("")
  const skipNextAiAutoFetchRef = useRef(false)

  const hydrateStripeUnits = useCallback(
    (units: StripePatternUnit[]) =>
      units.map((unit) => ({
        id: createStripeId(),
        color: {
          r: clampChannel(unit?.color?.r ?? 0),
          g: clampChannel(unit?.color?.g ?? 0),
          b: clampChannel(unit?.color?.b ?? 0),
        },
        widthPx: Math.max(1, Math.round(unit?.widthPx ?? 10)),
      })),
    [],
  )

  const persistStripePayload = useCallback(
    (stripePattern: StripePatternUnit[], groups: PaletteGroup[], sourceImage?: string | null) => {
      if (typeof window === "undefined") return
      const payloadToPersist: StripePayload = {
        stripePatternUnit: stripePattern,
        paletteGroups: groups,
        sourceImage: sourceImage ?? null,
        generatedAt: Date.now(),
      }
      try {
        let serialized = JSON.stringify(payloadToPersist)
        let byteLength =
          typeof TextEncoder !== "undefined" ? new TextEncoder().encode(serialized).length : serialized.length * 2
        if (byteLength > MAX_SESSION_PAYLOAD_BYTES && payloadToPersist.sourceImage) {
          delete payloadToPersist.sourceImage
          serialized = JSON.stringify(payloadToPersist)
          byteLength =
            typeof TextEncoder !== "undefined" ? new TextEncoder().encode(serialized).length : serialized.length * 2
        }
        if (byteLength > MAX_SESSION_PAYLOAD_BYTES) {
          console.warn(`Stripe payload too large to persist (${byteLength} bytes); clearing cached value.`)
          window.sessionStorage.removeItem(STRIPE_STORAGE_KEY)
        } else {
          window.sessionStorage.setItem(STRIPE_STORAGE_KEY, serialized)
        }
      } catch (error) {
        console.warn("Failed to persist stripe payload:", error)
      }
    },
    [],
  )

  const drawStripesWithRotation = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      {
        tileWidth,
        tileHeight,
        stripeCount,
        resolveSegment,
      }: {
        tileWidth: number
        tileHeight: number
        stripeCount: number
        resolveSegment: (stripeIndex: number, repeatIndex: number) => { width: number; fillStyle: string } | null
      },
    ) => {
      if (stripeCount <= 0) return
      const diagonal = Math.hypot(tileWidth, tileHeight)
      const coveragePadding = diagonal
      const coverageStart = -coveragePadding
      const coverageEnd = tileWidth + coveragePadding
      const angleRad = (rotationAngle * Math.PI) / 180
      ctx.save()
      ctx.translate(tileWidth / 2, tileHeight / 2)
      ctx.rotate(angleRad)
      ctx.translate(-tileWidth / 2, -diagonal / 2)
      let currentX = coverageStart
      let repeatIndex = 0
      let safety = 0
      const safetyLimit = stripeCount * 1000
      while (currentX < coverageEnd && safety < safetyLimit) {
        for (let stripeIndex = 0; stripeIndex < stripeCount; stripeIndex += 1) {
          const segment = resolveSegment(stripeIndex, repeatIndex)
          if (!segment) {
            safety += 1
            continue
          }
          const width = Math.max(1, Math.round(segment.width))
          const remaining = coverageEnd - currentX
          if (remaining <= 0) break
          const drawWidth = Math.min(width, remaining + 1)
          ctx.fillStyle = segment.fillStyle
          ctx.fillRect(currentX, 0, drawWidth, diagonal)
          currentX += width
          safety += 1
          if (currentX >= coverageEnd || safety >= safetyLimit) break
        }
        repeatIndex += 1
      }
      ctx.restore()
    },
    [rotationAngle],
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const raw = window.sessionStorage.getItem(STRIPE_STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as StripePayload
      if (!Array.isArray(parsed?.stripePatternUnit) || parsed.stripePatternUnit.length === 0) {
        return
      }
      const enriched = hydrateStripeUnits(parsed.stripePatternUnit)
      setStripeUnits(enriched)
      setPaletteGroups(Array.isArray(parsed.paletteGroups) ? parsed.paletteGroups : [])
      setPayloadMeta({ generatedAt: parsed.generatedAt, sourceImage: parsed.sourceImage })
      setSourceImagePreview(parsed.sourceImage ?? null)
    } catch (error) {
      console.error("Failed to parse stripe payload:", error)
      setLoadError("无法解析缓存的条纹数据，请重新上传图片。")
    }
  }, [hydrateStripeUnits])

  const handleSourceUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const file = input.files?.[0]
      if (!file) return

      setUploadError(null)
      setReextractError(null)
      setIsAnalyzingSource(true)

      try {
        const preview = await readFileAsDataUrl(file)
        setSourceImagePreview(preview)
        setSourceImageFile(file)

        const palette = await extractApiClient.requestColorPalettes(file)
        const groups = Array.isArray(palette?.groups) ? palette.groups : []
        setPaletteGroups(groups)

        const stripePattern = Array.isArray(palette?.stripePatternUnit)
          ? palette.stripePatternUnit.filter(
              (unit): unit is StripePatternUnit =>
                Boolean(unit) &&
                typeof unit.widthPx === "number" &&
                typeof unit.color === "object" &&
                unit.color !== null,
            )
          : []

        if (stripePattern.length === 0) {
          setStripeUnits([])
          setUploadError("未检测到条纹结构，请尝试更换图片或调整拍摄角度。")
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(STRIPE_STORAGE_KEY)
          }
        } else {
          const hydrated = hydrateStripeUnits(stripePattern)
          setStripeUnits(hydrated)
          persistStripePayload(stripePattern, groups, preview)
          setPayloadMeta({ generatedAt: Date.now(), sourceImage: preview })
          setSelectedStripeId(null)
          setEditingStripeId(null)
          setLoadError(null)
        }
      } catch (error) {
        console.error("Stripe source upload failed:", error)
        setUploadError(error instanceof Error ? error.message : "分析失败，请稍后重试。")
        setStripeUnits([])
        setPaletteGroups([])
      } finally {
        setIsAnalyzingSource(false)
        if (input) {
          input.value = ""
        }
      }
    },
    [hydrateStripeUnits, persistStripePayload],
  )

  const handleColorChange = useCallback((id: string, hex: string) => {
    const rgb = hexToRgb(hex)
    setStripeUnits((prev) =>
      prev.map((unit) => (unit.id === id ? { ...unit, color: { r: rgb.r, g: rgb.g, b: rgb.b } } : unit)),
    )
  }, [])

  const handleWidthChange = useCallback((id: string, value: number[]) => {
    const [width] = value
    setStripeUnits((prev) => prev.map((unit) => (unit.id === id ? { ...unit, widthPx: Math.max(1, Math.round(width)) } : unit)))
  }, [])

  const handleReorderStripe = useCallback((id: string, targetIndex: number) => {
    setStripeUnits((prev) => {
      const currentIndex = prev.findIndex((unit) => unit.id === id)
      if (currentIndex === -1) return prev
      const clampedTarget = Math.max(0, Math.min(prev.length - 1, targetIndex))
      if (currentIndex === clampedTarget) return prev
      const next = [...prev]
      const [moved] = next.splice(currentIndex, 1)
      next.splice(clampedTarget, 0, moved)
      return next
    })
  }, [])

  const editingStripe = useMemo(
    () => (editingStripeId ? stripeUnits.find((unit) => unit.id === editingStripeId) ?? null : null),
    [editingStripeId, stripeUnits],
  )

  const editingStripeIndex = useMemo(
    () => (editingStripeId ? stripeUnits.findIndex((unit) => unit.id === editingStripeId) : -1),
    [editingStripeId, stripeUnits],
  )

  useEffect(() => {
    if (selectedStripeId && !stripeUnits.some((unit) => unit.id === selectedStripeId)) {
      setSelectedStripeId(null)
    }
    if (editingStripeId && !stripeUnits.some((unit) => unit.id === editingStripeId)) {
      setEditingStripeId(null)
    }
  }, [editingStripeId, selectedStripeId, stripeUnits])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName
        if (target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
          return
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === "c") {
        if (!selectedStripeId) return
        const source = stripeUnits.find((unit) => unit.id === selectedStripeId)
        if (!source) return
        event.preventDefault()
        setCopiedStripe({
          color: { ...source.color },
          widthPx: source.widthPx,
        })
        return
      }
      if (event.key.toLowerCase() === "v") {
        if (!selectedStripeId || !copiedStripe) return
        const insertIndex = stripeUnits.findIndex((unit) => unit.id === selectedStripeId)
        if (insertIndex === -1) return
        event.preventDefault()
        const cloned: EditableStripeUnit = {
          id: createStripeId(),
          color: { ...copiedStripe.color },
          widthPx: Math.max(1, Math.round(copiedStripe.widthPx)),
        }
        setStripeUnits((prev) => {
          const targetIndex = prev.findIndex((unit) => unit.id === selectedStripeId)
          if (targetIndex === -1) return prev
          const next = [...prev]
          next.splice(targetIndex + 1, 0, cloned)
          return next
        })
        setSelectedStripeId(cloned.id)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [copiedStripe, selectedStripeId, stripeUnits])

  const handleStripeSelect = useCallback(
    (id: string) => {
      if (draggingStripeId) return
      setSelectedStripeId(id)
    },
    [draggingStripeId],
  )

  const handleStripeEdit = useCallback(
    (id: string) => {
      if (draggingStripeId) return
      setSelectedStripeId(id)
      setEditingStripeId(id)
    },
    [draggingStripeId],
  )

  const handleRemoveStripe = useCallback(
    (id: string) => {
      setStripeUnits((prev) => prev.filter((unit) => unit.id !== id))
      setSelectedStripeId((prev) => (prev === id ? null : prev))
      setEditingStripeId((prev) => (prev === id ? null : prev))
    },
    [],
  )

  const handleStripeDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, id: string) => {
    event.dataTransfer.effectAllowed = "move"
    try {
      event.dataTransfer.setData("text/plain", id)
    } catch {
      // some browsers may throw if dataTransfer is not available in this context
    }
    dragOverIdRef.current = null
    setDraggingStripeId(id)
  }, [])

  const handleStripeDragOver = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, id: string) => {
      event.preventDefault()
      if (!draggingStripeId || id === draggingStripeId) return
      if (dragOverIdRef.current === id) return
      dragOverIdRef.current = id
      const targetIndex = stripeUnits.findIndex((unit) => unit.id === id)
      if (targetIndex >= 0) {
        handleReorderStripe(draggingStripeId, targetIndex)
      }
    },
    [draggingStripeId, handleReorderStripe, stripeUnits],
  )

  const handleStripeDragEnd = useCallback(() => {
    setDraggingStripeId(null)
    dragOverIdRef.current = null
  }, [])

  const totalUnitWidth = useMemo(
    () => stripeUnits.reduce((acc, unit) => acc + Math.max(1, unit.widthPx), 0),
    [stripeUnits],
  )

  const normalizedUnitsForAi = useMemo(
    () =>
      stripeUnits.map((unit) => ({
        color: {
          r: clampChannel(unit.color.r),
          g: clampChannel(unit.color.g),
          b: clampChannel(unit.color.b),
        },
        widthPx: Math.max(1, Math.round(unit.widthPx)),
      })),
    [stripeUnits],
  )

  const handleReextract = useCallback(async () => {
    const fallbackSource = payloadMeta?.sourceImage ?? null
    if (!sourceImageFile && !fallbackSource) {
      setReextractError("请先上传一张参考图片，再尝试重新提取。")
      return
    }
    setReextractError(null)
    setIsReextracting(true)
    try {
      let workingFile = sourceImageFile
      let sourceReference = sourceImagePreview ?? fallbackSource ?? null

      if (!workingFile && fallbackSource) {
        const response = await fetch(fallbackSource)
        if (!response.ok) {
          throw new Error("无法获取原始图片。")
        }
        const blob = await response.blob()
        if (!blob || blob.size === 0) {
          throw new Error("获取到的图片为空。")
        }
        const inferredType = blob.type || "image/png"
        const extension = inferredType.includes("jpeg") ? "jpg" : inferredType.includes("png") ? "png" : "png"
        workingFile = new File([blob], `stripe-source-${Date.now()}.${extension}`, { type: inferredType })
        setSourceImageFile(workingFile)
        if (!sourceImagePreview) {
          const preview = await readFileAsDataUrl(workingFile)
          setSourceImagePreview(preview)
          sourceReference = preview
        }
      }

      if (!workingFile) {
        throw new Error("无法准备原始图片，请重新上传。")
      }

      const palette = await extractApiClient.requestColorPalettes(workingFile)
      const groups = Array.isArray(palette?.groups) ? palette.groups : []
      setPaletteGroups(groups)

      const stripePattern = Array.isArray(palette?.stripePatternUnit)
        ? palette.stripePatternUnit.filter(
            (unit): unit is StripePatternUnit =>
              Boolean(unit) &&
              typeof unit.widthPx === "number" &&
              typeof unit.color === "object" &&
              unit.color !== null,
          )
        : []

      if (stripePattern.length === 0) {
        setStripeUnits([])
        setReextractError("本次分析未检测到条纹结构，请检查图片或稍后再试。")
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(STRIPE_STORAGE_KEY)
        }
      } else {
        const refreshedUnits = hydrateStripeUnits(stripePattern)
        setStripeUnits(refreshedUnits)
        persistStripePayload(stripePattern, groups, sourceReference)
        setPayloadMeta({
          generatedAt: Date.now(),
          sourceImage: sourceReference,
        })
        setSelectedStripeId(null)
        setEditingStripeId(null)
        setLoadError(null)
      }
    } catch (error) {
      console.error("Re-extract stripe units failed:", error)
      setReextractError(error instanceof Error ? error.message : "重新提取失败，请稍后再试。")
    } finally {
      setIsReextracting(false)
    }
  }, [
    hydrateStripeUnits,
    persistStripePayload,
    payloadMeta?.sourceImage,
    sourceImageFile,
    sourceImagePreview,
  ])

  const fetchAiVariations = useCallback(async () => {
    if (normalizedUnitsForAi.length === 0) return
    const signature = JSON.stringify(normalizedUnitsForAi)
    aiRequestSignatureRef.current = signature
    setIsLoadingAiVariations(true)
    setAiError(null)
    try {
      const response = await extractApiClient.requestStripeVariations({
        stripeUnits: normalizedUnitsForAi,
        paletteGroups,
      })
      const cleanedVariations: StripeLLMVariation[] = Array.isArray(response?.variations)
        ? response.variations
            .map((variation) => {
              if (!variation || typeof variation !== "object") return null
              const title =
                typeof variation.title === "string" && variation.title.trim()
                  ? variation.title.trim()
                  : typeof (variation as any).name === "string" && (variation as any).name.trim()
                    ? (variation as any).name.trim()
                    : "AI Variation"
              const styleNoteRaw =
                typeof variation.styleNote === "string"
                  ? variation.styleNote
                  : typeof (variation as any).style_note === "string"
                    ? (variation as any).style_note
                    : typeof (variation as any).description === "string"
                      ? (variation as any).description
                      : undefined
              const rawUnits =
                Array.isArray(variation.stripeUnits) && variation.stripeUnits.length > 0
                  ? variation.stripeUnits
                  : Array.isArray((variation as any).stripes)
                    ? (variation as any).stripes
                    : []
              const sanitizedUnits = rawUnits
                .map((unit: any) => {
                  if (!unit || typeof unit !== "object") return null
                  const rawColor = unit.color || unit.colour || unit.rgb || {}
                  const relativeCandidate =
                    typeof unit.relativeWidth === "number"
                      ? unit.relativeWidth
                      : typeof unit.relativeWidth === "string"
                        ? Number.parseFloat(unit.relativeWidth)
                        : typeof unit.widthRatio === "number"
                          ? unit.widthRatio
                          : typeof unit.widthPx === "number"
                            ? unit.widthPx
                            : null
                  const relativeWidth = Number.isFinite(relativeCandidate) ? Math.abs(Number(relativeCandidate)) : 0
                  const color = {
                    r: clampChannel(Number(rawColor?.r ?? rawColor?.R ?? 0)),
                    g: clampChannel(Number(rawColor?.g ?? rawColor?.G ?? 0)),
                    b: clampChannel(Number(rawColor?.b ?? rawColor?.B ?? 0)),
                  }
                  if (relativeWidth <= 0) return null
                  return {
                    color,
                    relativeWidth,
                  }
                })
                .filter((unit): unit is { color: { r: number; g: number; b: number }; relativeWidth: number } => Boolean(unit))
              if (sanitizedUnits.length === 0) return null
              const total = sanitizedUnits.reduce((acc, unit) => acc + unit.relativeWidth, 0)
              if (total <= 0) return null
              const normalized = sanitizedUnits.map((unit) => ({
                color: unit.color,
                relativeWidth: Number((unit.relativeWidth / total).toFixed(4)),
              }))
              return {
                title,
                styleNote: styleNoteRaw?.trim() || undefined,
                stripeUnits: normalized,
              }
            })
            .filter((variation): variation is StripeLLMVariation => variation !== null)
        : []
      setAiVariations(cleanedVariations.slice(0, 6))
    } catch (error) {
      console.error("Stripe AI variation request failed:", error)
      setAiVariations([])
      setAiError(error instanceof Error ? error.message : "无法获取AI衍生方案，请稍后再试。")
    } finally {
      setIsLoadingAiVariations(false)
    }
  }, [normalizedUnitsForAi, paletteGroups])

  useEffect(() => {
    if (normalizedUnitsForAi.length === 0) return
    const signature = JSON.stringify(normalizedUnitsForAi)
    if (skipNextAiAutoFetchRef.current) {
      skipNextAiAutoFetchRef.current = false
      aiRequestSignatureRef.current = signature
      return
    }
    if (aiRequestSignatureRef.current === signature) return
    void fetchAiVariations()
  }, [normalizedUnitsForAi, fetchAiVariations])

  const handleRegenerateAiVariations = useCallback(() => {
    aiRequestSignatureRef.current = ""
    void fetchAiVariations()
  }, [fetchAiVariations])

  const applyAiVariation = useCallback(
    (variation: StripeLLMVariation) => {
      if (!variation?.stripeUnits || variation.stripeUnits.length === 0) return
      skipNextAiAutoFetchRef.current = true
      const baseWidth = Math.max(120, totalUnitWidth || 240)
      let accumulated = 0
      const nextUnits: EditableStripeUnit[] = variation.stripeUnits.map((stripe, index) => {
        const rawWidth = stripe?.relativeWidth ?? 0
        let widthPx = Math.max(1, Math.round(rawWidth * baseWidth))
        if (index === variation.stripeUnits.length - 1) {
          widthPx = Math.max(1, baseWidth - accumulated)
        }
        accumulated += widthPx
        return {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          color: {
            r: clampChannel(stripe.color.r),
            g: clampChannel(stripe.color.g),
            b: clampChannel(stripe.color.b),
          },
          widthPx,
        }
      })
      const sum = nextUnits.reduce((acc, unit) => acc + unit.widthPx, 0)
      if (sum !== baseWidth && nextUnits.length > 0) {
        const delta = baseWidth - sum
        nextUnits[nextUnits.length - 1] = {
          ...nextUnits[nextUnits.length - 1],
          widthPx: Math.max(1, nextUnits[nextUnits.length - 1].widthPx + delta),
        }
      }
      setStripeUnits(nextUnits)
      setSelectedStripeId(null)
      setEditingStripeId(null)
    },
    [setStripeUnits, totalUnitWidth],
  )

  useEffect(() => {
    if (stripeUnits.length === 0) {
      setBasePatternPreviewUrl(null)
      return
    }

    let cancelled = false

    const generatePreview = () => {
      const cycleSourceWidth = Math.max(
        1,
        totalUnitWidth || stripeUnits.reduce((acc, unit) => acc + Math.max(1, unit.widthPx), 0),
      )
      const cycleWidth = Math.max(240, Math.round(cycleSourceWidth)) || stripeUnits.length * 80
      const baseWidths: number[] = []
      let accumulated = 0

      for (let i = 0; i < stripeUnits.length; i += 1) {
        let width = Math.max(
          1,
          cycleSourceWidth === 0
            ? Math.round(cycleWidth / Math.max(1, stripeUnits.length))
            : Math.round((stripeUnits[i].widthPx / cycleSourceWidth) * cycleWidth),
        )
        if (i === stripeUnits.length - 1) {
          width = Math.max(1, cycleWidth - accumulated)
        }
        baseWidths.push(width)
        accumulated += width
      }

      if (baseWidths.length > 0) {
        const roundedTotal = baseWidths.reduce((acc, value) => acc + value, 0)
        const delta = cycleWidth - roundedTotal
        baseWidths[baseWidths.length - 1] = Math.max(1, baseWidths[baseWidths.length - 1] + delta)
      }

      window.requestAnimationFrame(() => {
        try {
          const repeatCount = 4
          const tileWidth = cycleWidth * repeatCount
          const tileHeight = tileWidth
          const canvas = document.createElement("canvas")
          const ctx = canvas.getContext("2d")
          if (!ctx) {
            if (!cancelled) setBasePatternPreviewUrl(null)
            return
          }

          canvas.width = tileWidth
          canvas.height = tileHeight
          ctx.fillStyle = "rgba(15, 23, 42, 0.04)"
          ctx.fillRect(0, 0, tileWidth, tileHeight)

          drawStripesWithRotation(ctx, {
            tileWidth,
            tileHeight,
            stripeCount: stripeUnits.length,
            resolveSegment: (stripeIndex) => {
              const unit = stripeUnits[stripeIndex]
              const width = baseWidths[stripeIndex]
              if (!unit || !Number.isFinite(width) || width <= 0) return null
              return {
                width,
                fillStyle: `rgb(${clampChannel(unit.color.r)}, ${clampChannel(unit.color.g)}, ${clampChannel(unit.color.b)})`,
              }
            },
          })

          const url = canvas.toDataURL("image/png")
          if (!cancelled) {
            setBasePatternPreviewUrl(url)
          }
        } catch (error) {
          console.error("Failed to render base stripe preview:", error)
          if (!cancelled) {
            setBasePatternPreviewUrl(null)
          }
        }
      })
    }

    generatePreview()

    return () => {
      cancelled = true
    }
  }, [stripeUnits, totalUnitWidth, drawStripesWithRotation])

  const handleReset = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(STRIPE_STORAGE_KEY)
    }
    setStripeUnits([])
    setPaletteGroups([])
    setSourceImageFile(null)
    setSourceImagePreview(null)
    setPayloadMeta({})
    setUploadError(null)
    setReextractError(null)
    setLoadError(null)
    setIsAnalyzingSource(false)
  }, []);

  return (
    <div className="container mx-auto max-w-6xl px-6 py-10 space-y-6">
      {loadError && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              无法加载缓存的条纹数据
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="destructive" onClick={handleReset}>
              清除缓存并重新上传
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-5 text-primary" />
              Stripe Source Image
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              上传含条纹的参考图片，系统会自动调用大模型识别基础循环，并生成调色盘。
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSourceUpload}
          />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzingSource}
                >
                  {isAnalyzingSource ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      分析中…
                    </>
                  ) : (
                    <>
                      <ImageIcon className="size-4" />
                      上传参考图片
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2"
                  onClick={handleReset}
                  disabled={isAnalyzingSource}
                >
                  <X className="size-4" />
                  清除当前数据
                </Button>
              </div>
              {sourceImageFile?.name && (
                <p className="text-xs text-muted-foreground">
                  当前文件：<span className="font-medium text-foreground">{sourceImageFile.name}</span>
                </p>
              )}
              {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
            </div>
            <div className="w-full max-w-xs">
              <div className="relative aspect-square overflow-hidden rounded-md border border-border/40 bg-muted/10">
                {sourceImagePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sourceImagePreview}
                    alt="已上传的条纹参考图"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                    <ImageIcon className="size-6 text-muted-foreground/70" />
                    <span>尚未选择图片</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <motion.div layout>
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PaintBucket className="size-5 text-primary" />
                Stripe Unit Palette
              </CardTitle>
              <p className="text-sm text-muted-foreground">Tweak stripe colors and widths to craft your base pattern.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        基础条纹构成
                      </Label>
                      <p className="text-sm text-muted-foreground">左键选中色块后，可从悬浮操作打开对话框微调颜色与宽度。</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Ruler className="size-3.5" />
                        {Math.round(totalUnitWidth)}px
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={handleReextract}
                        disabled={isReextracting || (!sourceImageFile && !payloadMeta?.sourceImage)}
                      >
                        {isReextracting ? (
                          <>
                            <RefreshCw className="size-3.5 animate-spin" />
                            重新提取中…
                          </>
                        ) : (
                          <>
                            <RefreshCw className="size-3.5" />
                            重新提取
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {reextractError ? (
                    <p className="text-xs text-destructive">{reextractError}</p>
                  ) : null}
                  <div className="rounded-lg border border-border/30 bg-background/60 p-4">
                    {stripeUnits.length > 0 ? (
                      <div className="flex h-24 w-full overflow-hidden rounded-md border border-border/40 shadow-inner">
                        {stripeUnits.map((unit, index) => {
                          const isSelected = selectedStripeId === unit.id
                          const isDragging = draggingStripeId === unit.id
                          const flexSizing = {
                            flexGrow: Math.max(1, unit.widthPx),
                            flexBasis: 0,
                          } as const
                          return (
                            <div
                              key={unit.id}
                              className="relative flex h-full min-w-[32px] flex-1 rounded-lg"
                              style={flexSizing}
                            >
                              <AnimatePresence>
                                {isSelected ? (
                                  <motion.div
                                    key="edit"
                                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                    className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center"
                                  >
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        handleStripeEdit(unit.id)
                                      }}
                                      className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/70 bg-black/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-lg hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                                    >
                                      调整
                                    </button>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                              {isSelected && (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 box-border rounded-[inherit] bg-[conic-gradient(at_50%_50%,#22d3ee_0deg,#6366f1_120deg,#ec4899_240deg,#f97316_360deg)]"
                                  style={{
                                    padding: "1.5px",
                                    WebkitMask:
                                      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                                    WebkitMaskComposite: "xor",
                                    maskComposite: "exclude",
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                draggable
                                onClick={() => handleStripeSelect(unit.id)}
                                onDragStart={(event) => handleStripeDragStart(event, unit.id)}
                                onDragOver={(event) => handleStripeDragOver(event, unit.id)}
                                onDragEnd={handleStripeDragEnd}
                                onDrop={(event) => event.preventDefault()}
                                className={`group relative z-[1] flex h-full w-full cursor-pointer items-end justify-center rounded-lg border-r border-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 hover:brightness-110 ${
                                  isDragging
                                    ? "z-10 scale-[1.02] ring-2 ring-primary/70"
                                    : isSelected
                                      ? "scale-[1.01] shadow-lg shadow-primary/30 outline outline-[1.5px] outline-white/60"
                                      : ""
                                }`}
                                style={{
                                  backgroundColor: `rgb(${unit.color.r}, ${unit.color.g}, ${unit.color.b})`,
                                }}
                                data-selected={isSelected ? "true" : undefined}
                                aria-pressed={isSelected}
                                aria-label={`调整条纹 ${index + 1}`}
                              >
                                {isSelected && (
                                  <span
                                    aria-hidden
                                    className="pointer-events-none absolute inset-0 rounded-lg border-2 border-white/70 mix-blend-screen"
                                  />
                                )}
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    handleRemoveStripe(unit.id)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      handleRemoveStripe(unit.id)
                                    }
                                  }}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onDragStart={(event) => event.stopPropagation()}
                                  className="group/close absolute right-1 top-1 hidden cursor-pointer rounded-full bg-black/60 p-0.5 text-white transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 group-hover:flex"
                                  aria-label={`移除条纹 ${index + 1}`}
                                >
                                  <X className="size-3.5" />
                                </span>
                                <span className="pointer-events-none absolute top-1 left-1 rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/90">
                                  #{index + 1}
                                </span>
                                <span className="pointer-events-none mb-2 rounded-md bg-black/35 px-2 py-0.5 text-[11px] font-medium text-white/90">
                                  {Math.round(unit.widthPx)}px
                                </span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/40 text-xs text-muted-foreground">
                        尚未解析到条纹，请上传或重新提取参考图片。
                        <span className="text-[11px] text-muted-foreground/80">支持 JPG / PNG，推荐正面条纹图案</span>
                      </div>
                    )}
                  </div>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    预览条纹比例与排列，选择目标色块以弹出细节调整窗。
                  </p>
                  {basePatternPreviewUrl && (
                    <div className="mx-auto w-full max-w-[220px] space-y-3 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewLightbox({
                            src: basePatternPreviewUrl,
                            title: "基础循环预览（4×重复）",
                          })
                        }
                        className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                      >
                        <div className="relative aspect-square overflow-hidden rounded-md border border-border/40 bg-background shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={basePatternPreviewUrl}
                            alt="Stripe base pattern preview"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                            <ZoomIn className="size-6 text-white opacity-0 transition group-hover:opacity-100" />
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Label
                      htmlFor="rotation-angle-slider"
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      条纹旋转
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{rotationAngle.toFixed(0)}°</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setRotationAngle(0)}
                        disabled={rotationAngle === 0}
                      >
                        重置
                      </Button>
                    </div>
                  </div>
                  <Slider
                    id="rotation-angle-slider"
                    min={-180}
                    max={180}
                    step={1}
                    value={[rotationAngle]}
                    onValueChange={(value) => {
                      const nextValue = Array.isArray(value) ? value[0] : value
                      const clamped = Math.max(-180, Math.min(180, Math.round(nextValue ?? 0)))
                      setRotationAngle(clamped)
                    }}
                  />
                </div>
                <Separator />
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-5 text-primary" />
                        <h3 className="text-base font-semibold">AI Stripe Inspirations</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        基于提取的RGB条纹信息，生成可拓展的艺术化配色方案。
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={handleRegenerateAiVariations}
                      disabled={isLoadingAiVariations || normalizedUnitsForAi.length === 0}
                    >
                      {isLoadingAiVariations ? (
                        <RefreshCw className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      重新生成
                    </Button>
                  </div>
                  {aiError && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                      {aiError}
                    </div>
                  )}
                  {!aiError && isLoadingAiVariations && (
                    <div className="rounded-lg border border-border/40 bg-muted/10 p-4 text-center text-sm text-muted-foreground">
                      <Sparkles className="mx-auto mb-2 size-7 animate-spin text-primary/80" />
                      正在为你生成条纹灵感…
                    </div>
                  )}
                  {!aiError && !isLoadingAiVariations && aiVariations.length === 0 && (
                    <div className="rounded-lg border border-border/40 bg-muted/10 p-4 text-center text-sm text-muted-foreground">
                      暂无AI衍生方案，可尝试调整条纹或点击“重新生成”获取灵感。
                    </div>
                  )}
                  {!aiError && aiVariations.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {aiVariations.map((variation, idx) => (
                        <button
                          key={`${variation.title}-${idx}`}
                          type="button"
                          onClick={() => applyAiVariation(variation)}
                          className="flex flex-col gap-3 rounded-lg border border-border/40 bg-background/60 p-3 text-left transition hover:border-primary/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                          aria-label={`应用AI色组 ${variation.title}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <h4 className="text-sm font-semibold text-foreground">{variation.title}</h4>
                              {variation.styleNote && (
                                <p className="text-xs text-muted-foreground">{variation.styleNote}</p>
                              )}
                            </div>
                            <Badge variant="outline" className="px-2 py-0 text-[10px] uppercase tracking-wide">
                              点击应用
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {variation.stripeUnits.map((stripe, stripeIdx) => (
                              <div
                                key={`${variation.title}-swatch-${stripeIdx}`}
                                className="flex flex-col items-center gap-1"
                              >
                                <span
                                  className="h-8 w-8 rounded-full border border-border/50 shadow-sm"
                                  style={{ backgroundColor: `rgb(${stripe.color.r}, ${stripe.color.g}, ${stripe.color.b})` }}
                                />
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  {Math.round(Math.max(0, stripe.relativeWidth) * 100)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
      </motion.div>
      <Dialog open={Boolean(editingStripe)} onOpenChange={(open) => { if (!open) setEditingStripeId(null) }}>
        <DialogContent className="max-w-md">
          {editingStripe && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">
                  调整条纹 #{stripeUnits.indexOf(editingStripe) + 1}
                </DialogTitle>
                <DialogDescription>
                  微调颜色与宽度会立即反映到基础条纹与所有预览中。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div
                  className="h-20 w-full rounded-md border border-border/40 shadow-inner"
                  style={{ backgroundColor: `rgb(${editingStripe.color.r}, ${editingStripe.color.g}, ${editingStripe.color.b})` }}
                />
                <div className="space-y-2">
                  <Label htmlFor={`dialog-color-${editingStripe.id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    颜色
                  </Label>
                  <div className="flex items-center gap-3">
                    <input
                      id={`dialog-color-${editingStripe.id}`}
                      type="color"
                      value={rgbToHex(editingStripe.color.r, editingStripe.color.g, editingStripe.color.b)}
                      onChange={(event) => handleColorChange(editingStripe.id, event.target.value)}
                      className="h-10 w-12 cursor-pointer appearance-none rounded border border-border/40 bg-transparent p-0.5"
                    />
                    <span className="text-sm text-muted-foreground">
                      RGB {editingStripe.color.r}, {editingStripe.color.g}, {editingStripe.color.b}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Label
                      htmlFor={`dialog-width-${editingStripe.id}`}
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      宽度
                    </Label>
                    <span className="font-medium text-foreground">{Math.round(editingStripe.widthPx)} px</span>
                  </div>
                  <Slider
                    id={`dialog-width-${editingStripe.id}`}
                    min={4}
                    max={240}
                    step={1}
                    value={[Math.round(editingStripe.widthPx)]}
                    onValueChange={(value) => handleWidthChange(editingStripe.id, value)}
                  />
                </div>
                {editingStripeIndex >= 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Label
                        htmlFor={`dialog-order-${editingStripe.id}`}
                        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        顺序
                      </Label>
                      <span className="font-medium text-foreground">
                        第 {editingStripeIndex + 1} 位 / {stripeUnits.length}
                      </span>
                    </div>
                    <Slider
                      id={`dialog-order-${editingStripe.id}`}
                      min={1}
                      max={Math.max(1, stripeUnits.length)}
                      step={1}
                      value={[editingStripeIndex + 1]}
                      onValueChange={(value) => {
                        const raw = Array.isArray(value) ? value[0] : value
                        const nextPosition = Math.max(1, Math.min(stripeUnits.length, Math.round(raw ?? editingStripeIndex + 1)))
                        handleReorderStripe(editingStripe.id, nextPosition - 1)
                      }}
                    />
                  </div>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setEditingStripeId(null)}>
                  完成
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(previewLightbox)} onOpenChange={(open) => { if (!open) setPreviewLightbox(null) }}>
        <DialogContent className="max-w-4xl">
          {previewLightbox && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">{previewLightbox.title}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-hidden rounded-md border border-border/40 bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewLightbox.src}
                  alt={previewLightbox.title}
                  className="h-full w-full object-contain"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewLightbox(null)}>
                  关闭预览
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

