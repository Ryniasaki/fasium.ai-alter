"use client"

import React from "react"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Scissors,
  Zap,
  ImageIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  RefreshCw,
  Crop,
  CheckCircle,
  Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { CollapsibleHeader } from "@/components/collapsible-header"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import Image, { type StaticImageData } from "next/image"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { extractApiClient } from "@/lib/extract-api-client"
import type { PaletteGroup } from "@/lib/extract-api-client"
import { useAuth } from "@/contexts/auth-context"
import previewSketch from "@/image/preview/f1_sketch.webp"
import previewThreeView from "@/image/preview/f1_threeview.webp"
import previewPattern1 from "@/image/preview/f2_pattern (1).webp"
import previewPattern2 from "@/image/preview/f2_pattern (2).webp"
import previewPattern3 from "@/image/preview/f2_pattern (3).webp"

const SEAMLESS_STORAGE_KEY = "extract_seamless_payload"
const REDESIGN_STORAGE_KEY = "redesign_prefill_payload"
const EXTRACT_PREFILL_KEY = "extract_prefill_image"
const EXTRACT_PREFILL_EVENT = "extract-prefill"

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type ExtractGalleryShot = {
  src: StaticImageData
  title: string
  description: string
  alt: string
}

const extractGalleryShots: ExtractGalleryShot[] = [
  {
    src: previewPattern1,
    title: "印花 1",
    description: "抽取原图纹样生成布料预览。",
    alt: "Fabric sample with extracted seamless pattern applied",
  },
  {
    src: previewPattern2,
    title: "印花 2",
    description: "演示多配色方案组合效果。",
    alt: "Pattern preview showcasing multiple colorways",
  },
]

type ExtractMode = "extract" | "variants"

interface ExtractPageProps {
  mode?: ExtractMode
}

export function ExtractPage({ mode = "extract" }: ExtractPageProps) {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const isVariantMode = mode === "variants"
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processingStep, setProcessingStep] = useState("")
  const [extractedImages, setExtractedImages] = useState<string[]>([])
  const [paletteGroups, setPaletteGroups] = useState<PaletteGroup[]>([])
  const [selectedPaletteIndex, setSelectedPaletteIndex] = useState(0)
  const [originalPaletteGroups, setOriginalPaletteGroups] = useState<PaletteGroup[]>([])
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [draggedColorIndex, setDraggedColorIndex] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState("original")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const extractedFileInputRef = useRef<HTMLInputElement>(null)
  const [isGalleryCollapsed, setIsGalleryCollapsed] = useState(false)
  const [isGalleryLocked, setIsGalleryLocked] = useState(false)
  const [isLoadingPalette, setIsLoadingPalette] = useState(false)
  const [isCropping, setIsCropping] = useState(false)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [cropPendingFile, setCropPendingFile] = useState<File | null>(null)
  const [cropNaturalSize, setCropNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [cropScale, setCropScale] = useState(1)
  const [cropMinScale, setCropMinScale] = useState(1)
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 })
  const [cropBoxSize, setCropBoxSize] = useState(0)
  const [rawImageFile, setRawImageFile] = useState<File | null>(null)
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const cropContainerRef = useRef<HTMLDivElement | null>(null)
  const cropDragStateRef = useRef<{ active: boolean; pointerId: number | null; lastX: number; lastY: number }>({
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  })
  const cropMaxScale = useMemo(() => Math.max(cropMinScale * 3, cropMinScale + 0.5), [cropMinScale])
  const cropSliderMax = useMemo(
    () => (Number.isFinite(cropMaxScale) && cropMaxScale > cropMinScale ? cropMaxScale : cropMinScale + 0.5),
    [cropMaxScale, cropMinScale],
  )
  const layoutColumns = isGalleryCollapsed ? "lg:grid-cols-[minmax(0,1fr)_3.5rem]" : "lg:grid-cols-2"

  useEffect(() => {
    if (uploadedImage && !isGalleryLocked) {
      setIsGalleryCollapsed(true)
      setIsGalleryLocked(true)
    }
  }, [uploadedImage, isGalleryLocked])

  const headerTitle = isVariantMode ? "Variant Overlay" : "Pattern Extraction"
  const headerDescription = isVariantMode
    ? "Apply overlays to generate fresh garment variants in seconds"
    : "AI-powered pattern isolation and extraction"
  const headerIcon = isVariantMode
    ? <Layers className="size-4 text-primary-foreground" />
    : <Scissors className="size-4 text-primary-foreground" />
  const headerBadge = undefined
  const primaryActionLabel = isVariantMode ? "Generate Variants" : "Extract Patterns"
  const processingButtonLabel = isVariantMode ? "Generating..." : "Extracting..."
  const submittingStepLabel = isVariantMode ? "Submitting variant task..." : "Submitting extract task..."
  const failureMessage = isVariantMode ? "变体生成任务失败" : "提取任务失败"
  const primaryButtonIcon = isVariantMode ? <Layers className="size-4" /> : <Scissors className="size-4" />
  const clonePaletteGroups = useCallback(
    (groups: PaletteGroup[]) =>
      groups.map((group) => ({
        ...group,
        colors: group.colors.map((color) => ({ ...color })),
      })),
    [],
  )
  const getCropBounds = useCallback(
    (scale: number) => {
      if (!cropNaturalSize || cropBoxSize === 0) {
        return { maxX: 0, maxY: 0 }
      }
      const displayWidth = cropNaturalSize.width * scale
      const displayHeight = cropNaturalSize.height * scale
      const maxX = Math.max(0, (displayWidth - cropBoxSize) / 2)
      const maxY = Math.max(0, (displayHeight - cropBoxSize) / 2)
      return { maxX, maxY }
    },
    [cropNaturalSize, cropBoxSize],
  )
  const readFileAsDataUrl = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("Failed to read image"))
        reader.readAsDataURL(file)
      }),
    [],
  )

  const loadExtractPrefill = useCallback(
    async (imageUrl: string) => {
      try {
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`)
        }
        const blob = await response.blob()
        const ext = blob.type?.split("/")[1] || "png"
        const file = new File([blob], `extract-prefill-${Date.now()}.${ext}`, { type: blob.type || "image/png" })
        const dataUrl = await readFileAsDataUrl(file)

        setUploadedImage(dataUrl)
        setUploadedFile(file)
        setRawImageFile(file)
        setRawImageSrc(dataUrl)
        setIsGalleryCollapsed(true)
        setIsGalleryLocked(true)
        setActiveTab("original")
      } catch (error) {
        console.error("Prefill extract failed:", error)
      }
    },
    [readFileAsDataUrl, setActiveTab, setIsGalleryCollapsed, setIsGalleryLocked],
  )

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const stored = window.sessionStorage.getItem(EXTRACT_PREFILL_KEY)
    if (stored) {
      window.sessionStorage.removeItem(EXTRACT_PREFILL_KEY)
      try {
        const parsed = JSON.parse(stored) as { imageUrl?: string }
        if (parsed?.imageUrl) {
          void loadExtractPrefill(parsed.imageUrl)
        }
      } catch (error) {
        console.error("Invalid extract prefill payload:", error)
      }
    }

    const handlePrefillEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ imageUrl?: string }>).detail
      if (detail?.imageUrl) {
        void loadExtractPrefill(detail.imageUrl)
      }
    }

    window.addEventListener(EXTRACT_PREFILL_EVENT, handlePrefillEvent as EventListener)
    return () => {
      window.removeEventListener(EXTRACT_PREFILL_EVENT, handlePrefillEvent as EventListener)
    }
  }, [loadExtractPrefill])

  const resetCropState = useCallback(() => {
    setCropNaturalSize(null)
    setCropScale(0)
    setCropMinScale(1)
    setCropPosition({ x: 0, y: 0 })
    setCropBoxSize(0)
    cropDragStateRef.current = { active: false, pointerId: null, lastX: 0, lastY: 0 }
  }, [])
  const startCropping = useCallback(
    (file: File, dataUrl: string) => {
      if (!dataUrl) return
      setCropPendingFile(file)
      setCropSource(dataUrl)
      setIsCropping(true)
      resetCropState()
    },
    [resetCropState],
  )
  useEffect(() => {
    if (!isCropping) return
    const updateSize = () => {
      if (cropContainerRef.current) {
        const rect = cropContainerRef.current.getBoundingClientRect()
        const size = Math.min(rect.width, rect.height)
        setCropBoxSize(size)
      }
    }
    const raf = window.requestAnimationFrame(updateSize)
    updateSize()
    window.addEventListener("resize", updateSize)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener("resize", updateSize)
    }
  }, [isCropping])
  useEffect(() => {
    if (!cropNaturalSize || cropBoxSize === 0) return
    const minScaleValue = Math.max(
      cropBoxSize / cropNaturalSize.width,
      cropBoxSize / cropNaturalSize.height,
    )
    const targetScale = Math.max(cropScale, minScaleValue)
    setCropMinScale(minScaleValue)
    if (targetScale !== cropScale) {
      setCropScale(targetScale)
    }
    const { maxX, maxY } = getCropBounds(targetScale)
    setCropPosition((prev) => ({
      x: clamp(prev.x, -maxX, maxX),
      y: clamp(prev.y, -maxY, maxY),
    }))
  }, [cropBoxSize, cropNaturalSize, cropScale, getCropBounds])
  const handleCropImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    setCropNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
  }, [])
  const handleCropPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isCropping || !cropSource) return
      event.preventDefault()
      const target = event.currentTarget
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // ignore failures on browsers that do not support pointer capture
      }
      cropDragStateRef.current = {
        active: true,
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      }
    },
    [cropSource, isCropping],
  )
  const handleCropPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = cropDragStateRef.current
      if (!drag.active) return
      event.preventDefault()
      const dx = event.clientX - drag.lastX
      const dy = event.clientY - drag.lastY
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      const { maxX, maxY } = getCropBounds(cropScale)
      setCropPosition((prev) => ({
        x: clamp(prev.x + dx, -maxX, maxX),
        y: clamp(prev.y + dy, -maxY, maxY),
      }))
    },
    [cropScale, getCropBounds],
  )
  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragStateRef.current
    if (drag.pointerId === null || event.pointerId !== drag.pointerId) return
    drag.active = false
    drag.pointerId = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore failures on browsers that do not support pointer capture
    }
  }, [])
  const handleCropPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      stopDragging(event)
    },
    [stopDragging],
  )
  const handleCropPointerLeave = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      stopDragging(event)
    },
    [stopDragging],
  )
  const handleCropScaleChange = useCallback(
    (value: number[]) => {
      const nextScale = typeof value[0] === "number" ? value[0] : cropScale
      const { maxX, maxY } = getCropBounds(nextScale)
      setCropScale(nextScale)
      setCropPosition((prev) => ({
        x: clamp(prev.x, -maxX, maxX),
        y: clamp(prev.y, -maxY, maxY),
      }))
    },
    [cropScale, getCropBounds],
  )
  const handleCancelCrop = useCallback(() => {
    setIsCropping(false)
    setCropPendingFile(null)
    setCropSource(null)
    resetCropState()
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [resetCropState, fileInputRef])
  const handleConfirmCrop = useCallback(async () => {
    if (!cropImageRef.current || !cropNaturalSize || !cropPendingFile || cropBoxSize === 0) {
      handleCancelCrop()
      return
    }

    const displayWidth = cropNaturalSize.width * cropScale
    const displayHeight = cropNaturalSize.height * cropScale

    const topLeftX = cropBoxSize / 2 - displayWidth / 2 + cropPosition.x
    const topLeftY = cropBoxSize / 2 - displayHeight / 2 + cropPosition.y

    const cropDisplayX = -topLeftX
    const cropDisplayY = -topLeftY
    const cropLength = cropBoxSize / cropScale

    const cropX = clamp(cropDisplayX / cropScale, 0, cropNaturalSize.width - cropLength)
    const cropY = clamp(cropDisplayY / cropScale, 0, cropNaturalSize.height - cropLength)

    const canvas = document.createElement("canvas")
    canvas.width = Math.round(cropLength)
    canvas.height = Math.round(cropLength)
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      console.error("Unable to create canvas context")
      handleCancelCrop()
      return
    }

    ctx.drawImage(
      cropImageRef.current,
      cropX,
      cropY,
      cropLength,
      cropLength,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    const originalType = (cropPendingFile.type || "image/png").toLowerCase()
    const outputType = originalType === "image/jpeg" || originalType === "image/jpg" ? "image/jpeg" : "image/png"
    const extension = outputType === "image/png" ? "png" : "jpg"
    const baseName = cropPendingFile.name.replace(/\.[^/.]+$/, "")
    const newFileName = `${baseName}-cropped.${extension}`

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), outputType))
    if (!blob) {
      console.error("Crop failed: unable to generate image")
      handleCancelCrop()
      return
    }

    const croppedFile = new File([blob], newFileName, { type: outputType })
    try {
      const dataUrl = await readFileAsDataUrl(croppedFile)
      setUploadedImage(dataUrl)
      setUploadedFile(croppedFile)
      setRawImageFile(cropPendingFile)
      const sourceForRecrop = cropSource ?? dataUrl
      setRawImageSrc(sourceForRecrop)
    } catch (error) {
      console.error("Failed to read cropped image", error)
    } finally {
      setCropPendingFile(null)
      setIsCropping(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }, [
    cropBoxSize,
    cropNaturalSize,
    cropPendingFile,
    cropPosition.x,
    cropPosition.y,
    cropScale,
    cropSource,
    handleCancelCrop,
    fileInputRef,
    readFileAsDataUrl,
  ])
  const handleAdjustCrop = useCallback(async () => {
    if (isCropping) return
    const file = rawImageFile ?? uploadedFile
    const existingSrc = rawImageSrc ?? uploadedImage
    if (!file) return
    let dataUrl = existingSrc
    if (!dataUrl) {
      try {
        dataUrl = await readFileAsDataUrl(file)
      } catch (error) {
        console.error("Unable to read image for cropping", error)
        return
      }
    }
    if (!dataUrl) return
    startCropping(file, dataUrl)
  }, [isCropping, rawImageFile, uploadedFile, rawImageSrc, uploadedImage, readFileAsDataUrl, startCropping])
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== "string") return
      startCropping(file, result)
    }
    reader.readAsDataURL(file)
    reader.onloadend = () => {
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }
  const handleExtractedImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    setActiveTab("extracted")
    try {
      setIsLoadingPalette(true)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("读取图片失败"))
        reader.readAsDataURL(file)
      })

      setExtractedImages([dataUrl])
      setPaletteGroups([])

      const palette = await extractApiClient.requestColorPalettes(file)
      const groups = Array.isArray(palette?.groups) ? palette.groups : []
      setPaletteGroups(groups)
      setOriginalPaletteGroups(clonePaletteGroups(groups))
      setSelectedPaletteIndex(0)
    } catch (error) {
      console.error("Extracted upload error:", error)
    } finally {
      setIsLoadingPalette(false)
      input.value = ""
    }
  }
  const handleExtract = async () => {
    if (!uploadedFile) return
    if (isVariantMode && !uploadedImage) return

    setIsProcessing(true)
    setProgress(0)
    setProcessingStep(submittingStepLabel)

    try {
      let palettePromise: Promise<PaletteGroup[]> | null = null
      if (!isVariantMode) {
        palettePromise = extractApiClient
          .requestColorPalettes(uploadedFile)
          .then((palette) => (Array.isArray(palette?.groups) ? palette.groups : []))
          .catch((e) => {
            console.warn("Palette request failed:", e)
            return []
          })
      }

      const resp = isVariantMode
        ? await extractApiClient.submitVariantOverlay(uploadedImage as string)
        : await extractApiClient.submitExtract(uploadedFile)

      setProgress(25)
      setProcessingStep("Waiting task to complete...")

      const maxAttempts = 60
      const delay = 2000
      let status
      for (let i = 0; i < maxAttempts; i++) {
        status = await extractApiClient.getTaskStatus(resp.taskId)
        if (status.status === "SUCCESS" || status.status === "FAILED") break
        await new Promise((r) => setTimeout(r, delay))
      }

      if (!status || status.status !== "SUCCESS") {
        throw new Error(failureMessage)
      }

      setProgress(75)
      setProcessingStep("Downloading results...")
      const outputs = await extractApiClient.completeTask(resp.taskId)
      setExtractedImages(outputs.outputs)

      if (palettePromise) {
        const groups = await palettePromise
        setPaletteGroups(groups)
        setOriginalPaletteGroups(clonePaletteGroups(groups))
        setSelectedPaletteIndex(0)
      } else {
        setPaletteGroups([])
        setOriginalPaletteGroups([])
        setSelectedPaletteIndex(0)
      }
      setActiveTab("extracted")
    } catch (e) {
      console.error(isVariantMode ? "Variant overlay error:" : "Extract error:", e)
    } finally {
      setIsProcessing(false)
      setProcessingStep("")
      setProgress(100)
    }
  }
  const handleSendToSeamless = useCallback(() => {
    if (!extractedImages.length) return
    try {
      if (typeof window !== "undefined") {
        const payload: {
          primaryImage: string
          galleryImages: string[]
          generatedAt: number
          sourceImage?: string | null
        } = {
          primaryImage: extractedImages[0],
          galleryImages: extractedImages.slice(1),
          generatedAt: Date.now(),
        }
        if (uploadedImage) {
          payload.sourceImage = uploadedImage
        }
        const serialized = JSON.stringify(payload)
        window.sessionStorage.setItem(SEAMLESS_STORAGE_KEY, serialized)
      }
      router.push("/seamless-patterns")
    } catch (error) {
      console.error("Navigate to seamless patterns failed:", error)
    }
  }, [extractedImages, router, uploadedImage])

  const handleSendToRedesign = useCallback((imageUrl: string) => {
    if (!imageUrl) return
    if (typeof window !== "undefined") {
      try {
        const payload = {
          imageUrl,
          source: "extract",
          createdAt: Date.now(),
        }
        window.sessionStorage.setItem(REDESIGN_STORAGE_KEY, JSON.stringify(payload))
      } catch (error) {
        console.error("Cache redesign payload failed:", error)
      }
    }
    router.push("/redesign")
  }, [router])
  const handlePaletteNavigate = (direction: "prev" | "next") => {
    setSelectedPaletteIndex((prev) => {
      if (paletteGroups.length === 0) return 0
      const nextIndex = direction === "next" ? prev + 1 : prev - 1
      if (nextIndex < 0) return paletteGroups.length - 1
      if (nextIndex >= paletteGroups.length) return 0
      return nextIndex
    })
  }

  const handleColorChannelChange = (
    groupIndex: number,
    colorIndex: number,
    channel: "r" | "g" | "b",
    value: number,
  ) => {
    const clampedValue = Math.max(0, Math.min(255, Math.round(value)))
    setPaletteGroups((prevGroups) =>
      prevGroups.map((group, gi) => {
        if (gi !== groupIndex) return group
        return {
          ...group,
          colors: group.colors.map((color, ci) => {
            if (ci !== colorIndex) return color
            return {
              ...color,
              [channel]: clampedValue,
            }
          }),
        }
      }),
    )
  }

  const handleAddColor = (groupIndex: number) => {
    setPaletteGroups((prevGroups) =>
      prevGroups.map((group, gi) => {
        if (gi !== groupIndex) return group
        if (group.colors.length >= 6) return group
        return {
          ...group,
          colors: [...group.colors, { r: 128, g: 128, b: 128 }],
        }
      }),
    )
  }

  const handleRemoveColor = (groupIndex: number, colorIndex: number) => {
    const confirmed = window.confirm("This will permanently remove the selected color from this palette group. Continue?")
    if (!confirmed) return
    setPaletteGroups((prevGroups) =>
      prevGroups.map((group, gi) => {
        if (gi !== groupIndex) return group
        return {
          ...group,
          colors: group.colors.filter((_, ci) => ci !== colorIndex),
        }
      }),
    )
  }

  const handleColorDragStart = (colorIndex: number) => {
    setDraggedColorIndex(colorIndex)
  }

  const handleColorDragEnd = () => {
    setDraggedColorIndex(null)
  }

  const handleColorReorder = (groupIndex: number, targetIndex: number) => {
    if (draggedColorIndex === null || draggedColorIndex === targetIndex) return
    setPaletteGroups(prevGroups =>
      prevGroups.map((group, gi) => {
        if (gi !== groupIndex) return group
        const colors = [...group.colors]
        const [moved] = colors.splice(draggedColorIndex, 1)
        colors.splice(targetIndex, 0, moved)
        return {
          ...group,
          colors,
        }
      }),
    )
    setDraggedColorIndex(null)
  }

  const handleOpenPreview = (url: string) => {
    setPreviewImageUrl(url)
    setIsPreviewOpen(true)
  }

  const handleResetCurrentPalette = (groupIndex: number) => {
    const originalGroup = originalPaletteGroups[groupIndex]
    if (!originalGroup) return
    const confirmed = window.confirm("Reset this palette group to its original recommended colors? All changes will be lost.")
    if (!confirmed) return
    setPaletteGroups((prevGroups) =>
      prevGroups.map((group, gi) => {
        if (gi !== groupIndex) return group
        return {
          ...group,
          colors: originalGroup.colors.map((color) => ({ ...color })),
        }
      }),
    )
  }

  React.useEffect(() => {
    if (paletteGroups.length === 0 && selectedPaletteIndex !== 0) {
      setSelectedPaletteIndex(0)
    } else if (selectedPaletteIndex >= paletteGroups.length && paletteGroups.length > 0) {
      setSelectedPaletteIndex(paletteGroups.length - 1)
    }
  }, [paletteGroups, selectedPaletteIndex])
  React.useEffect(() => {
    if (!isPreviewOpen) {
      setPreviewImageUrl(null)
    }
  }, [isPreviewOpen])

  // Settings 部分已简化，仅保留操作按钮

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <CollapsibleHeader
        title={headerTitle}
        description={headerDescription}
        icon={headerIcon}
        badge={headerBadge}
      />

      <div className="container mx-auto px-6 py-8">
        <div className={`grid gap-8 lg:items-start ${layoutColumns}`}>
          {/* Left Panel - Preview */}
          <div>
            <Card className="border-border/50 h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="size-5" />
                    Pattern Preview
                  </CardTitle>
                  {/* 去掉九宫格、刷新、导出按钮 */}
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                  <DialogContent className="max-w-3xl border-border/70 bg-background/95">
                    {previewImageUrl && (
                      <div className="relative mx-auto aspect-square w-full max-w-2xl overflow-hidden rounded-lg border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewImageUrl} alt="Pattern preview enlarged" className="h-full w-full object-contain" />
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <input
                  ref={extractedFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleExtractedImageUpload}
                  className="hidden"
                />

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="original">Original</TabsTrigger>
                    <TabsTrigger value="extracted">Extracted</TabsTrigger>
                  </TabsList>

                  <TabsContent value="original" className="mt-6">
                    {isCropping ? (
                      <div className="space-y-5">
                        <div>
                          <h3 className="text-lg font-semibold">Adjust Crop Area</h3>
                          <p className="text-sm text-muted-foreground">
                            Drag the image to choose the square crop. Use zoom for finer control.
                          </p>
                        </div>
                        <div className="grid gap-6 lg:grid-cols-5">
                          <div className="lg:col-span-3">
                            <div
                              ref={cropContainerRef}
                              className="relative mx-auto aspect-square w-full max-w-md cursor-move overflow-hidden rounded-xl border border-dashed border-primary/60 bg-muted/40"
                              onPointerDown={handleCropPointerDown}
                              onPointerMove={handleCropPointerMove}
                              onPointerUp={handleCropPointerUp}
                              onPointerLeave={handleCropPointerLeave}
                              onPointerCancel={handleCropPointerLeave}
                            >
                              {cropSource ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    ref={cropImageRef}
                                    src={cropSource}
                                    alt="Crop preview"
                                    className="pointer-events-none select-none absolute left-1/2 top-1/2"
                                    onLoad={handleCropImageLoad}
                                    style={{
                                      transform: `translate(-50%, -50%) translate(${cropPosition.x}px, ${cropPosition.y}px) scale(${cropScale})`,
                                      transformOrigin: "center",
                                      width: cropNaturalSize ? `${cropNaturalSize.width}px` : "auto",
                                      height: cropNaturalSize ? `${cropNaturalSize.height}px` : "auto",
                                      maxWidth: "none",
                                      maxHeight: "none",
                                    }}
                                  />
                                  <div className="pointer-events-none absolute inset-0 border border-white/80 mix-blend-overlay" />
                                </>
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                                  Loading image…
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="lg:col-span-2 flex flex-col justify-between gap-6">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="crop-zoom">Zoom</Label>
                                <Slider
                                  id="crop-zoom"
                                  value={[clamp(cropScale, cropMinScale, cropSliderMax)]}
                                  onValueChange={handleCropScaleChange}
                                  min={cropMinScale}
                                  max={cropSliderMax}
                                  step={0.01}
                                  disabled={!cropSource || !cropNaturalSize}
                                />
                              </div>
                              <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
                                <div className="flex items-center justify-between">
                                  <span>Drag image to move</span>
                                  <span>Output: Square</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-3">
                              <Button variant="ghost" onClick={handleCancelCrop} type="button">
                                Cancel
                              </Button>
                              <Button
                                onClick={() => {
                                  void handleConfirmCrop()
                                }}
                                disabled={!cropSource || !cropNaturalSize}
                                type="button"
                              >
                                Apply Crop
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : uploadedImage ? (
                      <div className="space-y-4">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => fileInputRef.current?.click()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              fileInputRef.current?.click()
                            }
                          }}
                          className="group relative mx-auto block aspect-square w-full max-w-md cursor-pointer overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          aria-label="Change model image"
                        >
                          <Image
                            src={uploadedImage || "/placeholder.svg"}
                            alt="Original model image"
                            fill
                            className="object-cover"
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="bg-white/90 text-foreground hover:bg-white"
                              onClick={(event) => {
                                event.stopPropagation()
                                fileInputRef.current?.click()
                              }}
                            >
                              <RefreshCw className="mr-2 size-4" />
                              Replace Image
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="bg-primary text-primary-foreground hover:bg-primary/90"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleAdjustCrop()
                              }}
                            >
                              <Crop className="mr-2 size-4" />
                              Adjust Crop
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-2"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <RefreshCw className="size-4" />
                            Replace Image
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="gap-2"
                            onClick={() => {
                              void handleAdjustCrop()
                            }}
                          >
                            <Crop className="size-4" />
                            Adjust Crop
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-96 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-center space-y-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        aria-label="Upload model image"
                      >
                        <ImageIcon className="size-12 text-muted-foreground mx-auto" />
                        <div>
                          <p className="text-lg font-medium">Upload a model image</p>
                          <p className="text-sm text-muted-foreground">Generate extracted patterns and color groups</p>
                        </div>
                      </button>
                    )}
                  </TabsContent>

                  <TabsContent value="extracted" className="mt-6">
                    <div className="flex flex-col items-center space-y-6">
                        {extractedImages.length > 0 ? (
                          <div className="relative w-full">
                            <div className="absolute right-0 top-0 z-10 flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={handleSendToSeamless}
                                disabled={isProcessing || extractedImages.length === 0}
                                size="sm"
                                className="gap-1 shadow-sm"
                              >
                                <ChevronRight className="size-3" />
                                Generate Seamless Pattern
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  const target = extractedImages[0]
                                  if (target) {
                                    handleSendToRedesign(target)
                                  }
                                }}
                                disabled={isProcessing || extractedImages.length === 0}
                                size="sm"
                                className="gap-1 shadow-sm"
                              >
                                <ChevronRight className="size-3 rotate-180" />
                                Redesign Selection
                              </Button>
                            </div>
                            <div className="pt-14 space-y-4">
                              {extractedImages.map((url, i) => (
                                <div key={i} className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-lg border">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPreview(url)}
                                    className="h-full w-full"
                                    aria-label={`Preview extracted pattern ${i + 1}`}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`extracted-${i}`} className="h-full w-full object-cover" />
                                  </button>
                                  <Badge className="absolute left-3 top-3 text-xs">extracted</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => extractedFileInputRef.current?.click()}
                            className="flex h-96 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-center space-y-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            aria-label="Upload extracted image"
                          >
                            <ImageIcon className="mx-auto size-12 text-muted-foreground" />
                            <div>
                              <p className="text-lg font-medium">Upload an extracted image</p>
                              <p className="text-sm text-muted-foreground">Analyze color groups without rerunning extraction</p>
                            </div>
                          </button>
                        )}

                        {isLoadingPalette && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="size-4 animate-spin" />
                            <span>Analyzing color groups…</span>
                          </div>
                        )}

                        {paletteGroups.length > 0 && paletteGroups[selectedPaletteIndex] && (
                          <div className="w-full max-w-xl space-y-4">
                            <div className="flex items-center justify-center gap-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePaletteNavigate("prev")}
                                aria-label="Previous color group"
                                disabled={paletteGroups.length <= 1}
                              >
                                <ChevronLeft className="size-4" />
                              </Button>
                              <div className="text-center">
                                <div className="flex items-center justify-center gap-2 text-sm font-semibold">
                                  <span>Suggested Color Groups</span>
                                  <Badge variant="secondary">RGB</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Group {selectedPaletteIndex + 1} of {paletteGroups.length}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePaletteNavigate("next")}
                                aria-label="Next color group"
                                disabled={paletteGroups.length <= 1}
                              >
                                <ChevronRight className="size-4" />
                              </Button>
                            </div>

                            <div className="flex flex-wrap justify-center gap-4">
                              {paletteGroups[selectedPaletteIndex].colors.map((c, ci) => {
                                const swatchIdBase = `color-${selectedPaletteIndex}-${ci}`
                                return (
                                  <Popover key={swatchIdBase}>
                                    <div
                                      className="group relative"
                                      onDragOver={(event) => event.preventDefault()}
                                      onDrop={(event) => {
                                        event.preventDefault()
                                        handleColorReorder(selectedPaletteIndex, ci)
                                      }}
                                    >
                                      <PopoverTrigger asChild>
                                        <button
                                          type="button"
                                          draggable
                                          onDragStart={() => handleColorDragStart(ci)}
                                          onDragEnd={handleColorDragEnd}
                                          className="h-12 w-12 cursor-grab rounded-md border shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:cursor-grabbing"
                                          style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                                          aria-label={`Adjust color ${ci + 1}`}
                                        />
                                      </PopoverTrigger>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleRemoveColor(selectedPaletteIndex, ci)
                                        }}
                                        className="absolute -right-2 -top-2 rounded-full border border-border bg-background p-1 text-muted-foreground shadow opacity-0 pointer-events-none transition group-hover:opacity-100 group-hover:pointer-events-auto hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                                        aria-label={`Remove color ${ci + 1}`}
                                      >
                                        <X className="size-3" />
                                      </button>
                                    </div>
                                    <PopoverContent className="w-64 space-y-4" align="center">
                                      <div className="space-y-2">
                                        <div className="text-sm font-semibold">Adjust Color</div>
                                        <div className="flex items-center gap-3">
                                          <div
                                            className="h-10 w-10 rounded border"
                                            style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                                          />
                                          <div className="text-xs text-muted-foreground">
                                            rgb({c.r}, {c.g}, {c.b})
                                          </div>
                                        </div>
                                      </div>

                                      {(["r", "g", "b"] as const).map((channel) => {
                                        const sliderId = `${swatchIdBase}-${channel}`
                                        const channelValue = c[channel]
                                        return (
                                          <div key={channel} className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <Label htmlFor={sliderId} className="uppercase">
                                                {channel}
                                              </Label>
                                              <span className="text-xs text-muted-foreground">{channelValue}</span>
                                            </div>
                                            <Slider
                                              id={sliderId}
                                              max={255}
                                              min={0}
                                              step={1}
                                              value={[channelValue]}
                                              onValueChange={(value) =>
                                                handleColorChannelChange(
                                                  selectedPaletteIndex,
                                                  ci,
                                                  channel,
                                                  value[0] ?? channelValue,
                                                )
                                              }
                                            />
                                          </div>
                                        )
                                      })}
                                    </PopoverContent>
                                  </Popover>
                                )
                              })}

                              <div className="flex items-center gap-2">
                                {paletteGroups[selectedPaletteIndex].colors.length < 6 && (
                                  <button
                                    type="button"
                                    onClick={() => handleAddColor(selectedPaletteIndex)}
                                    className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground shadow-sm transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                    aria-label="Add new color"
                                  >
                                    <Plus className="size-5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleResetCurrentPalette(selectedPaletteIndex)}
                                  className="flex h-12 w-12 items-center justify-center rounded-md border border-border text-green-600 shadow-sm transition hover:border-green-500 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label="Reset colors to recommended palette"
                                  disabled={!originalPaletteGroups[selectedPaletteIndex]}
                                >
                                  <RefreshCw className="size-5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                </Tabs>

                <div className="mt-6 w-full max-w-3xl mx-auto">
                  {activeTab === "original" && (
                    <Button
                      onClick={handleExtract}
                      disabled={isProcessing || isCropping || !uploadedFile}
                      className="w-full gap-2"
                    >
                      {isProcessing ? (
                        <>
                          <Clock className="size-4 animate-spin" />
                          {processingButtonLabel}
                        </>
                      ) : (
                        <>
                          {primaryButtonIcon}
                          {primaryActionLabel}
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {isProcessing && (
                  <div className="mt-6 rounded-lg border border-primary/50 bg-primary/5 p-6">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="size-2 rounded-full bg-primary animate-pulse" />
                        <span className="text-sm font-medium">{processingStep}</span>
                      </div>
                      <Progress value={progress} className="w-full" />
                      <p className="text-xs text-muted-foreground">
                        Processing time: ~{Math.ceil(((100 - progress) / 25) * 1.5)}s remaining
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {/* Right Panel - Gallery */}
          <div
            className={`relative w-full shrink-0 transition-[width] duration-300 ease-in-out min-w-[3rem] ${
              isGalleryCollapsed ? "lg:w-[3.5rem]" : "lg:w-full"
            }`}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                if (isGalleryLocked) return
                setIsGalleryCollapsed((prev) => !prev)
              }}
              aria-label={isGalleryCollapsed ? "Expand gallery" : "Collapse gallery"}
              disabled={isGalleryLocked}
              className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border-border bg-background shadow-sm lg:-left-3 lg:right-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGalleryCollapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <AnimatePresence initial={false}>
              {isGalleryCollapsed ? null : (
                <motion.aside
                  key="gallery-panel"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <CheckCircle className="size-4 text-primary" />
                        Quick Start
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      <ol className="list-decimal space-y-2 pl-5 text-xs sm:text-sm">
                        <li>{isVariantMode ? "上传一张想要生成变体效果的服装图。" : "上传一张带有印花纹理的服装图。"}</li>
                        <li>
                          点击{" "}
                          <span className="font-medium text-foreground">{primaryActionLabel}</span>。
                        </li>
                      </ol>
                    </CardContent>
                  </Card>
                  <div className="space-y-4 rounded-3xl border border-border/40 bg-card/80 p-6 shadow-sm backdrop-blur">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">Gallery</p>
                      <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ImageIcon className="size-5" />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {extractGalleryShots.map((shot) => (
                        <button
                          key={shot.title}
                          type="button"
                          onClick={() => handleOpenPreview(shot.src.src)}
                          className="group w-full overflow-hidden rounded-2xl border border-border/60 bg-background/70 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <div className="relative flex items-center justify-center bg-muted">
                            <Image
                              src={shot.src}
                              alt={shot.alt}
                              width={shot.src.width}
                              height={shot.src.height}
                              className="h-auto w-full max-h-72 object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                              sizes="(min-width: 1024px) 320px, 100vw"
                            />
                          </div>
                          <div className="space-y-1 p-3">
                            <p className="text-sm font-medium text-foreground">{shot.title}</p>
                            <p className="text-xs text-muted-foreground">{shot.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ExtractPageRoute() {
  return <ExtractPage mode="extract" />
}
