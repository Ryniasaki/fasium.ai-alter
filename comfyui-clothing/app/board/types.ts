export interface Tool {
  id: string
  name: string
  description: string
  category: string
  icon: string
  gradient: string
  tag: string
  isPopular?: boolean
}

export interface Category {
  id: string
  title: string
  icon: string
}

export interface DrawingPath {
  id: string
  points: { x: number; y: number }[]
}

export interface CanvasAsset {
  id: string
  type:
    | "image"
    | "note"
    | "prompt"
    | "sheet"
    | "nine-grid"
    | "stripe-extract"
    | "tri-view"
    | "try-on"
    | "creative-derivation"
    | "admaster-images"
    | "video-generation"
    | "remove-background"
    | "svg-vector"
  status?: "ready" | "loading"
  toolId?: string
  tenantTaskId?: string | null
  tenantTaskStatus?: string | null
  tenantTaskError?: string | null
  parentId?: string
  connectionLabel?: string
  url?: string
  previewUrl?: string
  content?: string
  name?: string
  createdAt?: string
  isNew?: boolean
  sourceProjectId?: string
  promptStatus?: "idle" | "refining" | "ready" | "generating"
  promptError?: string | null
  sheetStatus?: "idle" | "generating" | "ready" | "error"
  sheetError?: string | null
  sheetSourceAssetId?: string | null
  sheetProgress?: { current: number; total: number; label?: string }
  sheetProgressPercent?: number
  sheetAutoFitDone?: boolean
  sheetData?: {
    reportMarkdown: string
    sketches: {
      referenceUrl?: string
      triViewUrl?: string
      annotatedSketchUrl?: string
    }
  }
  gridStatus?: "idle" | "generating" | "splitting" | "ready" | "error"
  gridError?: string | null
  gridSourceAssetId?: string | null
  gridImageUrl?: string | null
  stripeSourceAssetId?: string | null
  stripeStatus?: "idle" | "extracting"
  stripeVariationStatus?: "idle" | "refreshing"
  stripeError?: string | null
  stripeUnits?: Array<{ color: { r: number; g: number; b: number }; widthPx: number }>
  stripeSelectedIndex?: number | null
  stripeRotationDeg?: number
  stripePaletteGroups?: Array<{ colors: Array<{ r: number; g: number; b: number }>; note?: string }>
  stripeVariations?: Array<{
    title: string
    styleNote?: string
    stripeUnits: Array<{ color: { r: number; g: number; b: number }; relativeWidth: number }>
  }>
  triViewStatus?: "idle" | "generating" | "ready" | "error"
  triViewError?: string | null
  triViewSourceAssetId?: string | null
  triViewYawDeg?: number
  triViewPitchDeg?: number
  triViewHasRotation?: boolean
  triViewSnapshots?: Array<{ id: string; yaw: number; pitch: number }>
  tryOnStatus?: "idle" | "generating" | "ready" | "error"
  tryOnError?: string | null
  tryOnModelAssetId?: string | null
  tryOnGarmentAssetIds?: string[] | null
  tryOnSelectedGarmentAssetId?: string | null
  tryOnUseMannequin?: boolean
  creativeStatus?: "idle" | "analyzing" | "generating" | "ready" | "error"
  creativeError?: string | null
  creativeSourceAssetId?: string | null
  creativeSourceAssetIds?: string[] | null
  creativeParams?: {
    category?: string
    subCategory?: string
    specificFeatures?: string
    fabricMaterial?: string
    trimmingMaterial?: string
    targetAudience?: string
    scene?: string
    detailMod?: string
    displayMode?: "product" | "model"
    variantCount?: number
    innovationLevel?: number
    visualStyle?: string
    mandatoryDetails?: string
    mandatoryStyle?: string
    evolutionSeeds?: string[]
  }
  admasterImageStatus?: "idle" | "analyzing" | "generating" | "ready" | "error"
  admasterImageError?: string | null
  admasterImageSourceAssetId?: string | null
  admasterImageSourceAssetIds?: string[] | null
  admasterImageStyle?: "ATHLETIC" | "LUXURY"
  admasterImageStylePrompt?: string | null
  admasterModelCount?: number
  admasterAnalysis?: {
    name?: string
    features?: string[]
    visualVibe?: string
    targetAudience?: string
    gender?: "male" | "female" | "unisex"
    category?: string
    suggestedLocations?: Array<{
      name: string
      description: string
      reasoning: string
    }>
  } | null
  admasterImageProgressPercent?: number
  videoGenerationStatus?: "idle" | "submitting" | "running" | "ready" | "error"
  videoGenerationError?: string | null
  videoGenerationSourceAssetId?: string | null
  videoGenerationPrompt?: string
  videoGenerationTaskId?: string | null
  videoGenerationProgressPercent?: number
  videoGenerationUrl?: string | null
  videoGenerationPreviewUrl?: string | null
  videoGenerationModel?: string | null
  videoGenerationMode?: "reference"
  videoGenerationSourceAssetIds?: string[] | null
  videoGenerationAspectRatio?: "auto" | "9:16" | "16:9" | "1:1"
  videoGenerationResolution?: "720P" | "1080P"
  videoGenerationDuration?: 5 | 10
  removeBackgroundStatus?: "idle" | "processing" | "ready" | "error"
  removeBackgroundError?: string | null
  removeBackgroundSourceAssetId?: string | null
  svgVectorStatus?: "idle" | "processing" | "ready" | "error"
  svgVectorError?: string | null
  svgVectorSourceAssetId?: string | null
  x: number
  y: number
  width: number
  height: number
}

export interface Task {
  id: string
  type: string
  date: string
  title: string
  status: string
  images: string[]
  isProtected?: boolean
  canvasAssets?: CanvasAsset[]
  drawings?: DrawingPath[]
  viewState?: {
    offsetX: number
    offsetY: number
    scale: number
  }
  tags?: string[]
  viewCount?: number
}

export interface RepositoryTask {
  id: string
  title: string
  images: string[]
  originalImages?: string[]
  date?: string
  source: "task" | "board"
  taskType?: string
  status?: string
  assetId?: string
  projectId?: string
}
