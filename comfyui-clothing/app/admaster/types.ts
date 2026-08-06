export interface AdAsset {
  id: string
  url: string
  videoUrl?: string
  videoTaskId?: string
  videoTaskStatus?: string
  type: "image"
  title: string
  description: string
  isGeneratingVideo: boolean
  isRedoing?: boolean
  videoError?: string
}

export interface ProductAnalysis {
  name: string
  features: string[]
  visualVibe: string
  targetAudience: string
  gender: "male" | "female" | "unisex"
  category: string
  suggestedLocations: Array<{
    name: string
    description: string
    reasoning: string
  }>
}

export interface AppState {
  sourceImage: string | null
  analysis: ProductAnalysis | null
  assets: AdAsset[]
  isProcessing: boolean
  error: string | null
  progressMessage: string
}
