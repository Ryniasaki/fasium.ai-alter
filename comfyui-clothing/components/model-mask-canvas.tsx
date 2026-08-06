"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
} from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MaskRegion = {
  id: string
  name: string
  mask: HTMLCanvasElement
  thumbnail: string
  offset: { x: number; y: number }
  scale: number
  patternId: string | null
}

type RenderInfo = {
  offsetX: number
  offsetY: number
  drawWidth: number
  drawHeight: number
  ratio: number
}

type ModelMaskCanvasProps = {
  modelImage: string | null
  patternImage: string | null
}

export type ModelMaskCanvasHandle = {
  exportComposite: (options?: { mimeType?: string; quality?: number }) => Promise<Blob | null>
}

type PatternOption = {
  id: string
  src: string
  label: string
  isPrimary: boolean
}

const DEFAULT_TOLERANCE = 35
const MIN_TOLERANCE = 10
const MAX_TOLERANCE = 80
const MIN_SCALE = 0.5
const MAX_SCALE = 2.5
const MODEL_LAYER_ID = "model-layer-fixed"
const LASSO_HOLD_DURATION_MS = 450
const MIN_LASSO_SIZE_PX = 12
const MAX_PATTERN_COUNT = 4

type LassoPoint = {
  x: number
  y: number
}

type DragState =
  | null
  | {
      layerId: string
      startX: number
      startY: number
      initialOffsetX: number
      initialOffsetY: number
    }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function polygonArea(points: LassoPoint[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area / 2)
}

function computeGradientMap(image: HTMLImageElement): Float32Array | null {
  const { width, height } = image
  if (width === 0 || height === 0) return null

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const grayscale = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    grayscale[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  const gradient = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = grayscale[(y - 1) * width + (x - 1)]
      const tc = grayscale[(y - 1) * width + x]
      const tr = grayscale[(y - 1) * width + (x + 1)]
      const ml = grayscale[y * width + (x - 1)]
      const mr = grayscale[y * width + (x + 1)]
      const bl = grayscale[(y + 1) * width + (x - 1)]
      const bc = grayscale[(y + 1) * width + x]
      const br = grayscale[(y + 1) * width + (x + 1)]

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br
      const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy))
      gradient[y * width + x] = magnitude
    }
  }

  for (let x = 0; x < width; x++) {
    gradient[x] = 255
    gradient[(height - 1) * width + x] = 255
  }
  for (let y = 0; y < height; y++) {
    gradient[y * width] = 255
    gradient[y * width + (width - 1)] = 255
  }

  return gradient
}

type FloodFillOptions = {
  allowedMask?: Uint8Array | null
  gradientThreshold?: number
}

function createMaskFromPoint(
  image: HTMLImageElement,
  gradientMap: Float32Array | null,
  startX: number,
  startY: number,
  tolerance: number,
  options: FloodFillOptions = {}
): HTMLCanvasElement | null {
  const width = image.width
  const height = image.height
  if (width === 0 || height === 0) {
    return null
  }

  const sourceCanvas = document.createElement("canvas")
  sourceCanvas.width = width
  sourceCanvas.height = height
  const sourceCtx = sourceCanvas.getContext("2d")
  if (!sourceCtx) return null
  sourceCtx.drawImage(image, 0, 0)

  const imageData = sourceCtx.getImageData(0, 0, width, height)
  const pixels = imageData.data
  const allowedMask = options.allowedMask ?? null

  const clampX = clamp(Math.round(startX), 0, width - 1)
  const clampY = clamp(Math.round(startY), 0, height - 1)
  const seedIndex = clampY * width + clampX
  if (allowedMask && allowedMask[seedIndex] === 0) {
    return null
  }

  const visited = new Uint8Array(width * height)
  const stack = [seedIndex]
  visited[seedIndex] = 1

  const seedOffset = seedIndex * 4
  const seedR = pixels[seedOffset]
  const seedG = pixels[seedOffset + 1]
  const seedB = pixels[seedOffset + 2]
  const toleranceSq = tolerance * tolerance * 3

  const baseGradient = gradientMap ? gradientMap[seedIndex] : 0
  const computedGradientThreshold = gradientMap
    ? Math.min(Math.max(baseGradient + 18, 25), 85)
    : Number.POSITIVE_INFINITY
  const gradientThreshold = options.gradientThreshold ?? computedGradientThreshold

  let regionSize = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) {
      continue
    }

    const base = current * 4
    const r = pixels[base]
    const g = pixels[base + 1]
    const b = pixels[base + 2]

    const dr = r - seedR
    const dg = g - seedG
    const db = b - seedB
    const distanceSq = dr * dr + dg * dg + db * db
    if (distanceSq > toleranceSq) {
      continue
    }

    visited[current] = 2
    regionSize++

    const x = current % width
    const y = Math.floor(current / width)

    const neighbors: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighborIndex = ny * width + nx
      if (visited[neighborIndex] !== 0) continue
      if (allowedMask && allowedMask[neighborIndex] === 0) continue
      if (gradientMap && gradientMap[neighborIndex] > gradientThreshold) continue
      visited[neighborIndex] = 1
      stack.push(neighborIndex)
    }
  }

  if (regionSize === 0) {
    return null
  }

  const maskCanvas = document.createElement("canvas")
  maskCanvas.width = width
  maskCanvas.height = height
  const maskCtx = maskCanvas.getContext("2d")
  if (!maskCtx) return null

  const maskImage = maskCtx.createImageData(width, height)
  const maskPixels = maskImage.data
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] === 2) {
      const offset = i * 4
      maskPixels[offset] = 255
      maskPixels[offset + 1] = 255
      maskPixels[offset + 2] = 255
      maskPixels[offset + 3] = 255
    }
  }
  maskCtx.putImageData(maskImage, 0, 0)

  return maskCanvas
}

function createMaskFromFreeformSelection(
  image: HTMLImageElement,
  gradientMap: Float32Array | null,
  polygon: LassoPoint[]
): HTMLCanvasElement | null {
  if (polygon.length < 3) return null

  const imageWidth = image.width
  const imageHeight = image.height
  if (imageWidth === 0 || imageHeight === 0) return null

  const selectionCanvas = document.createElement("canvas")
  selectionCanvas.width = imageWidth
  selectionCanvas.height = imageHeight
  const selectionCtx = selectionCanvas.getContext("2d")
  if (!selectionCtx) return null

  selectionCtx.fillStyle = "#fff"
  selectionCtx.beginPath()
  selectionCtx.moveTo(polygon[0].x, polygon[0].y)
  for (let i = 1; i < polygon.length; i++) {
    selectionCtx.lineTo(polygon[i].x, polygon[i].y)
  }
  selectionCtx.closePath()
  selectionCtx.fill()

  const minX = Math.max(0, Math.floor(Math.min(...polygon.map((point) => point.x))))
  const maxX = Math.min(imageWidth - 1, Math.ceil(Math.max(...polygon.map((point) => point.x))))
  const minY = Math.max(0, Math.floor(Math.min(...polygon.map((point) => point.y))))
  const maxY = Math.min(imageHeight - 1, Math.ceil(Math.max(...polygon.map((point) => point.y))))
  const regionWidth = maxX - minX + 1
  const regionHeight = maxY - minY + 1

  if (regionWidth <= 0 || regionHeight <= 0) return null

  const sourceCanvas = document.createElement("canvas")
  sourceCanvas.width = imageWidth
  sourceCanvas.height = imageHeight
  const sourceCtx = sourceCanvas.getContext("2d")
  if (!sourceCtx) return null
  sourceCtx.drawImage(image, 0, 0)

  const selectionData = selectionCtx.getImageData(minX, minY, regionWidth, regionHeight).data
  const imageData = sourceCtx.getImageData(minX, minY, regionWidth, regionHeight).data

  const allowedMask = new Uint8Array(imageWidth * imageHeight)

  let count = 0
  let gradientSum = 0
  let gradientCount = 0
  const bucketStats = new Map<
    number,
    { count: number; sumR: number; sumG: number; sumB: number }
  >()

  for (let y = 0; y < regionHeight; y++) {
    for (let x = 0; x < regionWidth; x++) {
      const offset = (y * regionWidth + x) * 4
      const globalIndex = (minY + y) * imageWidth + (minX + x)
      if (selectionData[offset + 3] === 0) continue

      allowedMask[globalIndex] = 1
      const r = imageData[offset]
      const g = imageData[offset + 1]
      const b = imageData[offset + 2]
      count++

      const rBucket = r >> 4
      const gBucket = g >> 4
      const bBucket = b >> 4
      const bucketKey = (rBucket << 8) | (gBucket << 4) | bBucket
      const stats = bucketStats.get(bucketKey)
      if (stats) {
        stats.count += 1
        stats.sumR += r
        stats.sumG += g
        stats.sumB += b
      } else {
        bucketStats.set(bucketKey, { count: 1, sumR: r, sumG: g, sumB: b })
      }

      if (gradientMap) {
        gradientSum += gradientMap[globalIndex]
        gradientCount++
      }
    }
  }

  if (count === 0 || bucketStats.size === 0) {
    return null
  }

  let dominantKey: number | null = null
  let dominantCount = -1
  bucketStats.forEach((stats, key) => {
    if (stats.count > dominantCount) {
      dominantCount = stats.count
      dominantKey = key
    }
  })

  if (dominantKey === null) {
    return null
  }

  const dominantStats = bucketStats.get(dominantKey)
  if (!dominantStats) {
    return null
  }

  const targetCount = dominantStats.count
  const targetR = dominantStats.sumR / targetCount
  const targetG = dominantStats.sumG / targetCount
  const targetB = dominantStats.sumB / targetCount

  let sumDistanceSq = 0
  let closestDistanceSq = Number.POSITIVE_INFINITY
  let closestGradientValue = Number.POSITIVE_INFINITY
  let seedLocalX = 0
  let seedLocalY = 0

  for (let y = 0; y < regionHeight; y++) {
    for (let x = 0; x < regionWidth; x++) {
      const offset = (y * regionWidth + x) * 4
      if (selectionData[offset + 3] === 0) continue

      const r = imageData[offset]
      const g = imageData[offset + 1]
      const b = imageData[offset + 2]
      const rBucket = r >> 4
      const gBucket = g >> 4
      const bBucket = b >> 4
      const bucketKey = (rBucket << 8) | (gBucket << 4) | bBucket
      if (bucketKey !== dominantKey) continue

      const dr = r - targetR
      const dg = g - targetG
      const db = b - targetB
      const distanceSq = dr * dr + dg * dg + db * db
      sumDistanceSq += distanceSq

      const gradientValue = gradientMap ? gradientMap[(minY + y) * imageWidth + (minX + x)] : 0
      if (
        distanceSq < closestDistanceSq ||
        (distanceSq === closestDistanceSq && gradientValue < closestGradientValue)
      ) {
        closestDistanceSq = distanceSq
        closestGradientValue = gradientValue
        seedLocalX = x
        seedLocalY = y
      }
    }
  }

  if (targetCount === 0) {
    return null
  }

  const avgDistance = Math.sqrt(sumDistanceSq / Math.max(targetCount, 1))
  const tolerance = clamp(avgDistance * 1.25, MIN_TOLERANCE, MAX_TOLERANCE)

  const seedX = minX + seedLocalX
  const seedY = minY + seedLocalY
  const gradientThreshold = gradientMap && gradientCount > 0 ? Math.min((gradientSum / gradientCount) + 18, 80) : undefined

  const floodMask = createMaskFromPoint(image, gradientMap, seedX, seedY, tolerance, {
    allowedMask,
    gradientThreshold,
  })
  if (!floodMask) return null

  const finalMask = document.createElement("canvas")
  finalMask.width = imageWidth
  finalMask.height = imageHeight
  const finalCtx = finalMask.getContext("2d")
  if (!finalCtx) return null
  finalCtx.drawImage(floodMask, 0, 0)
  finalCtx.globalCompositeOperation = "destination-in"
  finalCtx.drawImage(selectionCanvas, 0, 0)
  finalCtx.globalCompositeOperation = "source-over"

  return finalMask
}

function generateThumbnail(mask: HTMLCanvasElement): string {
  const thumbSize = 80
  const thumbCanvas = document.createElement("canvas")
  thumbCanvas.width = thumbSize
  thumbCanvas.height = thumbSize
  const ctx = thumbCanvas.getContext("2d")
  if (!ctx) return ""

  ctx.fillStyle = "#111827"
  ctx.fillRect(0, 0, thumbSize, thumbSize)

  ctx.fillStyle = "#1f2937"
  ctx.fillRect(0, 0, thumbSize, thumbSize)

  const ratio = Math.min(thumbSize / mask.width, thumbSize / mask.height)
  const drawWidth = mask.width * ratio
  const drawHeight = mask.height * ratio
  const offsetX = (thumbSize - drawWidth) / 2
  const offsetY = (thumbSize - drawHeight) / 2

  ctx.globalAlpha = 0.35
  ctx.drawImage(mask, offsetX, offsetY, drawWidth, drawHeight)
  ctx.globalAlpha = 1

  return thumbCanvas.toDataURL("image/png")
}

export const ModelMaskCanvas = forwardRef<ModelMaskCanvasHandle, ModelMaskCanvasProps>(
  ({ modelImage, patternImage }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const renderInfoRef = useRef<RenderInfo | null>(null)
  const dragStateRef = useRef<DragState>(null)
  const pointerInfoRef = useRef<{
    pointerId: number
    startCanvasX: number
    startCanvasY: number
    startImageX: number
    startImageY: number
    currentCanvasX: number
    currentCanvasY: number
  } | null>(null)
  const longPressTimeoutRef = useRef<number | null>(null)
  const suppressNextClickRef = useRef(false)

  const [layers, setLayers] = useState<MaskRegion[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<string>(MODEL_LAYER_ID)
  const [colorTolerance, setColorTolerance] = useState(DEFAULT_TOLERANCE)
  const [modelHtmlImage, setModelHtmlImage] = useState<HTMLImageElement | null>(null)
  const [patternOptions, setPatternOptions] = useState<PatternOption[]>([])
  const [patternElements, setPatternElements] = useState<Record<string, HTMLImageElement>>({})
  const [gradientMap, setGradientMap] = useState<Float32Array | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 480, height: 480 })
  const [isLassoActive, setIsLassoActive] = useState(false)
  const [lassoPath, setLassoPath] = useState<LassoPoint[]>([])
  const lassoPathRef = useRef<LassoPoint[]>([])
  const additionalPatternInputRef = useRef<HTMLInputElement | null>(null)
  const [preferredPatternId, setPreferredPatternId] = useState<string | null>(null)
  const preferredPatternIdRef = useRef<string | null>(null)

  const addMaskLayer = useCallback((maskCanvas: HTMLCanvasElement) => {
    const layerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const availablePatternIds = patternOptions.map((option) => option.id)
    const preferredPatternId = preferredPatternIdRef.current
    const initialPatternId =
      preferredPatternId && availablePatternIds.includes(preferredPatternId)
        ? preferredPatternId
        : availablePatternIds[0] ?? null
    setLayers((prev) => [
      ...prev,
      {
        id: layerId,
        name: `蒙版 ${prev.length + 1}`,
        mask: maskCanvas,
        thumbnail: generateThumbnail(maskCanvas),
        offset: { x: 0, y: 0 },
        scale: 1,
        patternId: initialPatternId,
      },
    ])
    setSelectedLayerId(layerId)
  }, [patternOptions])

  useEffect(() => {
    if (!modelImage) {
      setModelHtmlImage(null)
      setGradientMap(null)
      setLayers([])
      setSelectedLayerId(MODEL_LAYER_ID)
      return
    }
    const img = new Image()
    img.onload = () => {
      setModelHtmlImage(img)
      setGradientMap(computeGradientMap(img))
      setSelectedLayerId(MODEL_LAYER_ID)
    }
    img.src = modelImage
  }, [modelImage])

  useEffect(() => {
    if (!patternImage) {
      setPatternOptions((prev) => prev.filter((option) => !option.isPrimary))
      return
    }
    const primaryOption: PatternOption = {
      id: "primary-pattern",
      src: patternImage,
      label: "主印花",
      isPrimary: true,
    }
    setPatternOptions((prev) => {
      const existingIndex = prev.findIndex((option) => option.isPrimary)
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = primaryOption
        return next
      }
      if (prev.length >= MAX_PATTERN_COUNT) {
        const preserved = prev.filter((option) => !option.isPrimary).slice(0, MAX_PATTERN_COUNT - 1)
        return [primaryOption, ...preserved]
      }
      return [primaryOption, ...prev]
    })
  }, [patternImage])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width } = entry.contentRect
      const size = Math.min(Math.max(width, 280), 640)
      setCanvasSize({ width: size, height: size })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const activeIds = new Set(patternOptions.map((option) => option.id))
    setPatternElements((prev) => {
      const next: Record<string, HTMLImageElement> = {}
      let changed = false
      Object.entries(prev).forEach(([id, img]) => {
        if (activeIds.has(id)) {
          next[id] = img
        } else {
          changed = true
        }
      })
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev
      }
      return next
    })

    patternOptions.forEach((option) => {
      setPatternElements((prev) => {
        if (prev[option.id]) {
          return prev
        }

        const img = new Image()
        img.onload = () => {
          setPatternElements((current) => {
            if (current[option.id]) {
              return current
            }
            return { ...current, [option.id]: img }
          })
        }
        img.src = option.src
        return prev
      })
    })
  }, [patternOptions])

  useEffect(() => {
    if (patternOptions.length === 0) {
      preferredPatternIdRef.current = null
      setPreferredPatternId(null)
      setLayers((prev) => {
        const next = prev.map((layer) => (layer.patternId === null ? layer : { ...layer, patternId: null }))
        return next.every((layer, index) => layer === prev[index]) ? prev : next
      })
      return
    }

    const defaultPatternId = patternOptions[0]?.id ?? null
    setLayers((prev) => {
      let changed = false
      const next = prev.map((layer) => {
        if (layer.patternId && patternOptions.some((option) => option.id === layer.patternId)) {
          return layer
        }
        if (layer.patternId === defaultPatternId) {
          return layer
        }
        changed = true
        return { ...layer, patternId: defaultPatternId }
      })
      return changed ? next : prev
    })

    if (preferredPatternIdRef.current && !patternOptions.some((option) => option.id === preferredPatternIdRef.current)) {
      preferredPatternIdRef.current = defaultPatternId
      setPreferredPatternId(defaultPatternId ?? null)
    } else if (!preferredPatternIdRef.current && defaultPatternId) {
      preferredPatternIdRef.current = defaultPatternId
      setPreferredPatternId(defaultPatternId)
    }
  }, [patternOptions])

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvasSize.width
    const height = canvasSize.height
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, width, height)

    if (!modelHtmlImage) {
      ctx.fillStyle = "#1f2937"
      ctx.fillRect(0, 0, width, height)
      renderInfoRef.current = null
      return
    }

    const ratio = Math.min(width / modelHtmlImage.width, height / modelHtmlImage.height)
    const drawWidth = modelHtmlImage.width * ratio
    const drawHeight = modelHtmlImage.height * ratio
    const offsetX = (width - drawWidth) / 2
    const offsetY = (height - drawHeight) / 2
    renderInfoRef.current = { offsetX, offsetY, drawWidth, drawHeight, ratio }

    ctx.drawImage(modelHtmlImage, offsetX, offsetY, drawWidth, drawHeight)

    if (layers.length === 0) {
      return
    }

    layers.forEach((layer) => {
      const patternElement = layer.patternId ? patternElements[layer.patternId] : null
      const overlay = document.createElement("canvas")
      overlay.width = modelHtmlImage.width
      overlay.height = modelHtmlImage.height
      const overlayCtx = overlay.getContext("2d")
      if (!overlayCtx) return

      if (patternElement) {
        const scaledWidth = Math.max(4, patternElement.width * layer.scale)
        const scaledHeight = Math.max(4, patternElement.height * layer.scale)
        overlayCtx.save()
        overlayCtx.globalAlpha = 0.5

        const startX =
          ((layer.offset.x % scaledWidth) + scaledWidth) % scaledWidth - scaledWidth
        const startY =
          ((layer.offset.y % scaledHeight) + scaledHeight) % scaledHeight - scaledHeight

        for (let x = startX; x < overlay.width + scaledWidth; x += scaledWidth) {
          for (let y = startY; y < overlay.height + scaledHeight; y += scaledHeight) {
            overlayCtx.drawImage(patternElement, x, y, scaledWidth, scaledHeight)
          }
        }
        overlayCtx.restore()
      } else {
        overlayCtx.fillStyle = "rgba(59,130,246,0.35)"
        overlayCtx.fillRect(0, 0, overlay.width, overlay.height)
      }

      overlayCtx.globalCompositeOperation = "destination-in"
      overlayCtx.drawImage(layer.mask, 0, 0)
      overlayCtx.globalCompositeOperation = "source-over"

      ctx.drawImage(overlay, offsetX, offsetY, drawWidth, drawHeight)
    })
  }, [canvasSize.height, canvasSize.width, layers, modelHtmlImage, patternElements])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  useImperativeHandle(
    ref,
    () => ({
      exportComposite: async ({ mimeType = "image/png", quality }: { mimeType?: string; quality?: number } = {}) => {
        drawCanvas()
        const canvas = canvasRef.current
        if (!canvas) {
          return null
        }
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        return await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(
            (blob) => {
              resolve(blob)
            },
            mimeType,
            quality
          )
        })
      },
    }),
    [drawCanvas]
  )

  const updateLayer = useCallback((layerId: string, updater: (layer: MaskRegion) => MaskRegion) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId ? updater(layer) : layer)))
  }, [])

  const handleAddPatternButtonClick = useCallback(() => {
    additionalPatternInputRef.current?.click()
  }, [])

  const handleAdditionalPatternUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const result = loadEvent.target?.result
      if (typeof result !== "string") return

      setPatternOptions((prev) => {
        if (prev.length >= MAX_PATTERN_COUNT) {
          return prev
        }
        const customIndex = prev.filter((option) => !option.isPrimary).length + 1
        const option: PatternOption = {
          id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          src: result,
          label: `印花 ${customIndex}`,
          isPrimary: false,
        }
        return [...prev, option]
      })
    }
    reader.readAsDataURL(file)
  }, [])

  const handleSelectPattern = useCallback(
    (patternId: string) => {
      preferredPatternIdRef.current = patternId
      setPreferredPatternId(patternId)
      if (selectedLayerId === MODEL_LAYER_ID) {
        return
      }
      updateLayer(selectedLayerId, (layer) => {
        if (layer.patternId === patternId) {
          return layer
        }
        return { ...layer, patternId }
      })
    },
    [selectedLayerId, updateLayer]
  )

  const handleRemovePattern = useCallback((patternId: string) => {
    setPatternOptions((prev) => prev.filter((option) => option.id !== patternId))
    setPatternElements((prev) => {
      if (!prev[patternId]) {
        return prev
      }
      const next = { ...prev }
      delete next[patternId]
      return next
    })
    if (preferredPatternIdRef.current === patternId) {
      preferredPatternIdRef.current = null
      setPreferredPatternId(null)
    }
  }, [])

  const handleCanvasClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      if (selectedLayerId !== MODEL_LAYER_ID) {
        return
      }
      if (!modelHtmlImage) return
      const renderInfo = renderInfoRef.current
      if (!renderInfo) return

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const clickY = event.clientY - rect.top

      if (
        clickX < renderInfo.offsetX ||
        clickY < renderInfo.offsetY ||
        clickX > renderInfo.offsetX + renderInfo.drawWidth ||
        clickY > renderInfo.offsetY + renderInfo.drawHeight
      ) {
        return
      }

      const imageX = (clickX - renderInfo.offsetX) / renderInfo.ratio
      const imageY = (clickY - renderInfo.offsetY) / renderInfo.ratio
      const maskCanvas = createMaskFromPoint(modelHtmlImage, gradientMap, imageX, imageY, colorTolerance)
      if (!maskCanvas) {
        return
      }

      addMaskLayer(maskCanvas)
    },
    [addMaskLayer, colorTolerance, gradientMap, modelHtmlImage, selectedLayerId]
  )
const isPointInsideMask = useCallback((layer: MaskRegion, imageX: number, imageY: number) => {
    const maskCtx = layer.mask.getContext("2d")
    if (!maskCtx) return false
    const data = maskCtx.getImageData(Math.round(imageX), Math.round(imageY), 1, 1).data
    return data[3] > 0
  }, [])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const renderInfo = renderInfoRef.current
      const canvas = canvasRef.current
      if (!renderInfo || !canvas) return

      const rect = canvas.getBoundingClientRect()
      let pointerX = event.clientX - rect.left
      let pointerY = event.clientY - rect.top

      const minCanvasX = renderInfo.offsetX
      const maxCanvasX = renderInfo.offsetX + renderInfo.drawWidth
      const minCanvasY = renderInfo.offsetY
      const maxCanvasY = renderInfo.offsetY + renderInfo.drawHeight

      if (
        pointerX < minCanvasX ||
        pointerY < minCanvasY ||
        pointerX > maxCanvasX ||
        pointerY > maxCanvasY
      ) {
        return
      }

      pointerX = clamp(pointerX, minCanvasX, maxCanvasX)
      pointerY = clamp(pointerY, minCanvasY, maxCanvasY)

      const imageX = (pointerX - renderInfo.offsetX) / renderInfo.ratio
      const imageY = (pointerY - renderInfo.offsetY) / renderInfo.ratio

      if (selectedLayerId === MODEL_LAYER_ID) {
        pointerInfoRef.current = {
          pointerId: event.pointerId,
          startCanvasX: pointerX,
          startCanvasY: pointerY,
          startImageX: imageX,
          startImageY: imageY,
          currentCanvasX: pointerX,
          currentCanvasY: pointerY,
        }
        if (longPressTimeoutRef.current !== null) {
          window.clearTimeout(longPressTimeoutRef.current)
        }
        longPressTimeoutRef.current = window.setTimeout(() => {
          if (!pointerInfoRef.current) return
          const startPoint: LassoPoint = {
            x: clamp(pointerInfoRef.current.currentCanvasX, minCanvasX, maxCanvasX),
            y: clamp(pointerInfoRef.current.currentCanvasY, minCanvasY, maxCanvasY),
          }
          lassoPathRef.current = [startPoint]
          setLassoPath([startPoint])
          setIsLassoActive(true)
        }, LASSO_HOLD_DURATION_MS)
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {
          // ignore
        }
        return
      }

      const layer = layers.find((l) => l.id === selectedLayerId)
      if (!layer) return

      if (!isPointInsideMask(layer, imageX, imageY)) {
        return
      }

      dragStateRef.current = {
        layerId: layer.id,
        startX: imageX,
        startY: imageY,
        initialOffsetX: layer.offset.x,
        initialOffsetY: layer.offset.y,
      }
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    },
    [isPointInsideMask, layers, selectedLayerId]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const renderInfo = renderInfoRef.current
      const canvas = canvasRef.current
      if (!renderInfo || !canvas) return

      const rect = canvas.getBoundingClientRect()
      let pointerX = event.clientX - rect.left
      let pointerY = event.clientY - rect.top

      const minCanvasX = renderInfo.offsetX
      const maxCanvasX = renderInfo.offsetX + renderInfo.drawWidth
      const minCanvasY = renderInfo.offsetY
      const maxCanvasY = renderInfo.offsetY + renderInfo.drawHeight

      pointerX = clamp(pointerX, minCanvasX, maxCanvasX)
      pointerY = clamp(pointerY, minCanvasY, maxCanvasY)

      if (isLassoActive) {
        if (lassoPathRef.current.length > 0) {
          const lastPoint = lassoPathRef.current[lassoPathRef.current.length - 1]
          if (Math.hypot(pointerX - lastPoint.x, pointerY - lastPoint.y) >= 2) {
            const nextPoint: LassoPoint = { x: pointerX, y: pointerY }
            lassoPathRef.current.push(nextPoint)
            setLassoPath(lassoPathRef.current.slice())
          }
        }
        return
      }

      if (pointerInfoRef.current && pointerInfoRef.current.pointerId === event.pointerId) {
        pointerInfoRef.current.currentCanvasX = pointerX
        pointerInfoRef.current.currentCanvasY = pointerY
        if (longPressTimeoutRef.current !== null) {
          const dx = pointerX - pointerInfoRef.current.startCanvasX
          const dy = pointerY - pointerInfoRef.current.startCanvasY
          if (Math.hypot(dx, dy) > 8) {
            window.clearTimeout(longPressTimeoutRef.current)
            longPressTimeoutRef.current = null
          }
        }
      }

      if (selectedLayerId === MODEL_LAYER_ID) {
        return
      }

      const dragState = dragStateRef.current
      if (!dragState) return

      const imageX = (pointerX - renderInfo.offsetX) / renderInfo.ratio
      const imageY = (pointerY - renderInfo.offsetY) / renderInfo.ratio

      const deltaX = imageX - dragState.startX
      const deltaY = imageY - dragState.startY

      setLayers((prev) =>
        prev.map((layer) =>
          layer.id === dragState.layerId
            ? {
                ...layer,
                offset: {
                  x: dragState.initialOffsetX + deltaX,
                  y: dragState.initialOffsetY + deltaY,
                },
              }
            : layer
        )
      )
    },
    [isLassoActive, selectedLayerId]
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (canvas) {
        try {
          canvas.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }

      if (selectedLayerId === MODEL_LAYER_ID) {
        if (longPressTimeoutRef.current !== null) {
          window.clearTimeout(longPressTimeoutRef.current)
          longPressTimeoutRef.current = null
        }

        const renderInfo = renderInfoRef.current
        if (isLassoActive && renderInfo && modelHtmlImage && lassoPathRef.current.length >= 3) {
          const polygon = lassoPathRef.current.map((point) => ({
            x: clamp((point.x - renderInfo.offsetX) / renderInfo.ratio, 0, Math.max(0, modelHtmlImage.width - 1)),
            y: clamp((point.y - renderInfo.offsetY) / renderInfo.ratio, 0, Math.max(0, modelHtmlImage.height - 1)),
          }))

          const polygonAreaValue = polygonArea(polygon)
          const minimumArea = Math.pow(MIN_LASSO_SIZE_PX / Math.max(renderInfo.ratio, 0.0001), 2)

          if (polygonAreaValue >= minimumArea) {
            const maskCanvas = createMaskFromFreeformSelection(modelHtmlImage, gradientMap, polygon)
            if (maskCanvas) {
              suppressNextClickRef.current = true
              addMaskLayer(maskCanvas)
            }
          }
        }

        setIsLassoActive(false)
        lassoPathRef.current = []
        setLassoPath([])
        pointerInfoRef.current = null
        return
      }

      dragStateRef.current = null
      pointerInfoRef.current = null
    },
    [addMaskLayer, gradientMap, isLassoActive, modelHtmlImage, selectedLayerId]
  )

  const handleRemoveLayer = useCallback((id: string) => {
    if (id === MODEL_LAYER_ID) return
    setLayers((prev) => {
      const next = prev.filter((layer) => layer.id !== id)
      setSelectedLayerId((current) => {
        if (current === id) {
          return next.length > 0 ? next[next.length - 1].id : MODEL_LAYER_ID
        }
        return current
      })
      return next
    })
  }, [])

  useEffect(() => {
    setSelectedLayerId((current) => {
      if (current === MODEL_LAYER_ID) {
        return layers.length === 0 ? MODEL_LAYER_ID : current
      }
      if (!layers.some((layer) => layer.id === current)) {
        return layers.length > 0 ? layers[layers.length - 1].id : MODEL_LAYER_ID
      }
      return current
    })
  }, [layers])

  const hasPattern = useMemo(() => patternOptions.length > 0, [patternOptions])
  const selectedLayer = useMemo(() => {
    if (selectedLayerId === MODEL_LAYER_ID) return null
    return layers.find((layer) => layer.id === selectedLayerId) || null
  }, [layers, selectedLayerId])
  const selectedLayerHasPattern = useMemo(() => {
    if (!selectedLayer?.patternId) return false
    return Boolean(patternElements[selectedLayer.patternId])
  }, [patternElements, selectedLayer])
  const activePatternId = selectedLayer?.patternId ?? preferredPatternId
  const canAddPattern = patternOptions.length < MAX_PATTERN_COUNT

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="md:w-3/4 space-y-4">
        <div ref={containerRef} className="relative w-full">
          <canvas
            ref={canvasRef}
            className={cn(
              "w-full rounded-lg border border-border bg-muted/40 outline-none",
              selectedLayer ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
            )}
            onClick={handleCanvasClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            role="presentation"
          />
          {isLassoActive && lassoPath.length >= 2 && (
            <svg
              className="pointer-events-none absolute inset-0"
              width={canvasSize.width}
              height={canvasSize.height}
              viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
              preserveAspectRatio="none"
            >
              <path
                d={`M${lassoPath[0].x},${lassoPath[0].y} ${lassoPath
                  .slice(1)
                  .map((point) => `L${point.x},${point.y}`)
                  .join(" ")} Z`}
                fill="rgba(59,130,246,0.12)"
                stroke="rgba(59,130,246,0.9)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray="8 4"
              />
              <circle
                cx={lassoPath[lassoPath.length - 1].x}
                cy={lassoPath[lassoPath.length - 1].y}
                r={4}
                fill="rgba(59,130,246,0.9)"
              />
            </svg>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            点击衣服可通过近似色生成蒙版；长按并拖动可启动魔法钩索框选主色区域；选中图层后可在画布上拖动印花位置，并通过右侧列表调整或删除。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                新建蒙版颜色容差 <span className="text-foreground">{colorTolerance}</span>
              </span>
              <input
                type="range"
                min={MIN_TOLERANCE}
                max={MAX_TOLERANCE}
                step={5}
                value={colorTolerance}
                onChange={(event) => setColorTolerance(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="md:w-1/4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">印花</h4>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={handleAddPatternButtonClick}
              disabled={!canAddPattern}
              aria-label="添加印花"
            >
              <Plus className="size-4" />
            </Button>
            <input
              ref={additionalPatternInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAdditionalPatternUpload}
            />
          </div>

          {patternOptions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
              点击右侧加号上传印花，最多可保存 4 种，蒙版图层可单独切换使用。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {patternOptions.map((option) => {
                const isActive = option.id === activePatternId
                const isAssignedToLayer = option.id === selectedLayer?.patternId
                return (
                  <div
                    key={option.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isAssignedToLayer}
                    className={cn(
                      "group relative flex w-24 cursor-pointer flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isAssignedToLayer
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/60 hover:bg-muted/40"
                    )}
                    onClick={() => handleSelectPattern(option.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        handleSelectPattern(option.id)
                      }
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={option.src}
                      alt={option.label}
                      className={cn(
                        "h-14 w-full rounded object-cover transition-transform",
                        isActive ? "ring-2 ring-primary" : ""
                      )}
                    />
                    <span className="text-xs font-medium">{option.isPrimary ? "当前印花" : option.label}</span>
                    {!selectedLayer && option.id === activePatternId && (
                      <span className="text-[10px] text-muted-foreground">新建蒙版时默认使用</span>
                    )}
                    {!option.isPrimary && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleRemovePattern(option.id)
                        }}
                        aria-label="删除印花"
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!canAddPattern && (
            <p className="text-xs text-muted-foreground">已达到 4 个印花上限，可删除现有印花后再上传新的图案。</p>
          )}
          {selectedLayer ? (
            <p className="text-xs text-muted-foreground">点击缩略图可切换当前蒙版图层使用的印花。</p>
          ) : (
            <p className="text-xs text-muted-foreground">选中具体蒙版图层后可切换其印花效果。</p>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">图层</h4>
          {!modelImage ? (
            <p className="text-xs text-muted-foreground">请先上传模特图片以创建蒙版图层。</p>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-2 py-2 text-left transition-colors",
                  selectedLayerId === MODEL_LAYER_ID
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/60 hover:bg-muted/40"
                )}
                onClick={() => setSelectedLayerId(MODEL_LAYER_ID)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={modelImage || "/placeholder.svg"}
                  alt="模特"
                  className="h-12 w-12 rounded border border-border object-cover"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">模特</p>
                  <p className="text-xs text-muted-foreground">选中后点击拾取，长按拖动启用魔法钩索</p>
                </div>
              </button>

              {layers.length === 0 && (
                <p className="text-xs text-muted-foreground">目前没有印花图层，点击模特图层以创建。</p>
              )}

              {layers.map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-2 py-2 text-left transition-colors",
                    layer.id === selectedLayerId
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/60 hover:bg-muted/40"
                  )}
                  onClick={() => setSelectedLayerId(layer.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={layer.thumbnail}
                    alt={layer.name}
                    className="h-12 w-12 rounded border border-border object-cover"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{layer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      偏移 ({Math.round(layer.offset.x)}, {Math.round(layer.offset.y)}) · 缩放{" "}
                      {Math.round(layer.scale * 100)}%
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleRemoveLayer(layer.id)
                    }}
                  >
                    删除
                  </Button>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedLayer && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              图层设置
            </h5>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                印花缩放 <span className="text-foreground">{Math.round(selectedLayer.scale * 100)}%</span>
              </span>
              <input
                type="range"
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={0.1}
                value={selectedLayer.scale}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  updateLayer(selectedLayer.id, (layer) => ({ ...layer, scale: value }))
                }}
                disabled={!selectedLayerHasPattern}
              />
            </label>

            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() =>
                updateLayer(selectedLayer.id, (layer) => ({
                  ...layer,
                  offset: { x: 0, y: 0 },
                  scale: 1,
                }))
              }
            >
              重置图层调整
            </Button>
          </div>
        )}

        {!hasPattern && (
          <p className="text-xs text-muted-foreground">
            上传或添加印花后可拖动并调整各蒙版图层上的图案效果。
          </p>
        )}
      </div>
    </div>
  )
})

ModelMaskCanvas.displayName = "ModelMaskCanvas"

