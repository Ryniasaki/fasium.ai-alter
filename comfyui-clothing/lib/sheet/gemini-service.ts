/**
 * Temporary placeholder implementations for the F8 Sheet experience.
 * These stubs keep the UI functional while the new vision / text-to-image
 * providers are integrated. Replace each generator with the actual API calls
 * once the upstream services are finalized.
 */

"use client"

import { textToImageApiClient, type AspectRatio } from "@/lib/text-to-image-api-client"
import type {
  DesignBrief,
  ProjectData,
  TechPack,
  TechnicalSketches,
  SketchData,
  CostEstimation,
  BillOfMaterialsItem,
  SpecSheetItem,
} from "./types"

const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABn0lEQVR4Xu3aQQ3CMBBE0XOIlOwAWFADlAAVOAAr0A3QgYJW8j9SIHo6zu2r2kzy07n3tm/Ozs7Ozj3uvXn1Kq1Wq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq9Xq/X+T+GmXAtZBG6AacTfQGegK3E30BnYBdwNdgb2AXcDXYG1wFtgN3Ad2BtMBXYGcwHdgZTAX2BlsBdYCUwF1gJTAXWAk0BdYCQwF1gJDAWWAnMBdYCUwF1gJTAXWAkMBdYCQwF1gJDAWWAnMBdYCUwF1gJTAXWAkMBdYCQwF1gJDAWWAnMBdYCUwF1gJTAXWAkMBdYCQwF1gJDAWWAnMBdYCUwF1gJTAXWAkMBdYCQwF1gJDAWWAnMBdYCUwF18/0EekmZn9G7jHbAAAAAElFTkSuQmCC"

const buildAnnotations = () => [
  { text: "Shoulder seam double stitch", x: 25, y: 18 },
  { text: "Waist elastic tunnel", x: 50, y: 55 },
  { text: "Hem overlock finish", x: 30, y: 85 },
]

const buildSketch = (_view?: string): SketchData => ({
  image: PLACEHOLDER_IMAGE,
  annotations: buildAnnotations(),
})

const DEFAULT_BOM: BillOfMaterialsItem[] = [
  { item: "Shell Fabric", description: "285gsm recycled nylon blend" },
  { item: "Lining", description: "Lightweight mesh, 80gsm" },
  { item: "Trims", description: "YKK zipper + matte snaps" },
]

const DEFAULT_SPECS: SpecSheetItem[] = [
  { pointOfMeasure: "Chest Width (M)", measurement: "56 cm ±1cm" },
  { pointOfMeasure: "Body Length (M)", measurement: "72 cm ±1cm" },
  { pointOfMeasure: "Sleeve Length (M)", measurement: "64 cm ±1cm" },
]

const DEFAULT_TECH_PACK: TechPack = {
  description: "Auto-generated placeholder tech pack",
  billOfMaterials: DEFAULT_BOM,
  specSheet: DEFAULT_SPECS,
  constructionDetails: [
    "Use double-needle topstitch for center front seam",
    "Attach lining to shell via clean finishing at hem",
    "Include hanger loop at back neck",
  ],
}

const DEFAULT_COST: CostEstimation = {
  garmentType: "Outerwear",
  costBreakdown: [
    { item: "Shell Fabric", consumption: "1.8 m", unitPrice: "$4.20/m", cost: 7.56 },
    { item: "Lining", consumption: "1.2 m", unitPrice: "$2.10/m", cost: 2.52 },
    { item: "Trims & Findings", consumption: "1 set", unitPrice: "$3.40", cost: 3.4 },
  ],
  totalEstimatedCost: 13.48,
  notes: ["Costs are placeholders until the new model is wired up."],
}

const API_BASE_URL = "/api"

const buildPlaceholderVisual = (description: string, index: number) =>
  `${PLACEHOLDER_IMAGE}#${encodeURIComponent(description)}-${index}`

const TEXT_TO_IMAGE_POLL_INTERVAL_MS = 2500
const TEXT_TO_IMAGE_MAX_WAIT_MS = 2 * 60 * 1000 // 2 minutes
const DEFAULT_ASPECT_RATIO: AspectRatio = "9:16"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const pickAspectRatio = (_brief: DesignBrief): AspectRatio => DEFAULT_ASPECT_RATIO

const normalizeTaskId = (taskId: unknown): string | null => {
  if (!taskId) return null
  if (typeof taskId === "string" && taskId.trim().length > 0) return taskId
  if (typeof taskId === "object") {
    const value = (taskId as { taskId?: string; id?: string })?.taskId ?? (taskId as { id?: string }).id
    if (value && typeof value === "string" && value.trim().length > 0) return value
  }
  return null
}

const formatMaterials = (brief: DesignBrief) => {
  if (!brief.materials || brief.materials.length === 0) return ""
  const lines = brief.materials
    .filter((mat) => (mat.name && mat.name.trim()) || (mat.specs && mat.specs.trim()))
    .map((mat) => {
      const name = mat.name?.trim() || "Material"
      const specs = mat.specs?.trim()
      return `- ${name}${specs ? `: ${specs}` : ""}`
    })
  if (!lines.length) return ""
  return `\n\nMaterials & trims to highlight:\n${lines.join("\n")}`
}

const buildVisualPrompt = (brief: DesignBrief, variationIndex: number): string => {
  const description = brief.description?.trim() || "a couture outfit"
  const base = [
    `Create a photorealistic full-body studio fashion photoshoot of ${description}.`,
    "Use a neutral seamless background, professional lighting, and pose the model naturally to showcase the garment details.",
  ]

  if (brief.designImages && brief.designImages.length > 0) {
    base.push(
      `The designer also uploaded reference images. Keep silhouettes, proportions, and signature details consistent with those inspirations while still presenting a clean key visual.`,
    )
  }

  base.push(
    "Render rich fabric textures, accurate drape, and clear finishing details so apparel developers can understand the construction at a glance.",
  )
  base.push(`Variation focus: option #${variationIndex + 1}. Push subtle styling differences to give the designer choices.`)
  const materialsBlock = formatMaterials(brief)

  return `${base.join(" ")}${materialsBlock}`
}

const convertImageUrlToBase64 = async (imageUrl: string): Promise<string> => {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download generated image (status ${response.status})`)
  }
  const blob = await response.blob()
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Failed to read generated image blob"))
    reader.onloadend = () => {
      const result = reader.result as string
      const [, payload] = result.split(",")
      resolve(payload || result)
    }
    reader.readAsDataURL(blob)
  })
  return base64
}

const waitForImageUrl = async (taskId: string): Promise<string> => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < TEXT_TO_IMAGE_MAX_WAIT_MS) {
    const status = await textToImageApiClient.getTaskStatus(taskId)
    if (status.status === "SUCCESS") {
      const { outputs } = await textToImageApiClient.completeTask(taskId)
      if (outputs.length === 0) {
        throw new Error("Text-to-image task completed but no outputs were returned.")
      }
      return outputs[0]!
    }
    if (status.status === "FAILED") {
      const message =
        typeof status.message === "string"
          ? status.message
          : status.message
            ? JSON.stringify(status.message)
            : "Text-to-image task failed."
      throw new Error(message)
    }
    await wait(TEXT_TO_IMAGE_POLL_INTERVAL_MS)
  }
  throw new Error("Text-to-image generation timed out.")
}

const runTextToImageWorkflow = async (prompt: string, aspectRatio: AspectRatio): Promise<string> => {
  const submission = await textToImageApiClient.submitTextToImage(prompt, aspectRatio)
  const taskId = normalizeTaskId(submission.taskId)
  if (!taskId) {
    throw new Error("Failed to obtain task ID from text-to-image submission.")
  }
  const imageUrl = await waitForImageUrl(taskId)
  return convertImageUrlToBase64(imageUrl)
}

export async function generateVisualConcepts(brief: DesignBrief, numOptions = 1): Promise<string[]> {
  const aspectRatio = pickAspectRatio(brief)
  const concepts: string[] = []
  for (let i = 0; i < numOptions; i += 1) {
    const prompt = buildVisualPrompt(brief, i)
    const image = await runTextToImageWorkflow(prompt, aspectRatio)
    concepts.push(image)
  }
  return concepts
}

const getToken = () => {
  if (typeof window === "undefined") return null
  return localStorage.getItem("token") || localStorage.getItem("auth_token")
}

const buildAuthHeaders = (): HeadersInit => {
  const headers: HeadersInit = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers["Authorization"] = `Bearer ${token}`
  return headers
}

async function postSheetEndpoint<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message = (detail && (detail.detail || detail.error)) || response.statusText || "Request failed"
    throw new Error(message)
  }
  return (await response.json()) as T
}

export async function generateTechnicalSketches(brief: DesignBrief): Promise<Omit<TechnicalSketches, "lining">> {
  try {
    return await postSheetEndpoint<Omit<TechnicalSketches, "lining">>(
      "/proxy/llm/sheet/technical_sketches",
      {
        brief,
      },
    )
  } catch (error) {
    console.error("generateTechnicalSketches failed, falling back to placeholder:", error)
    return {
      front: buildSketch("front"),
      back: buildSketch("back"),
    }
  }
}

export async function generateLiningSketch(brief: DesignBrief): Promise<SketchData | undefined> {
  try {
    const result = await postSheetEndpoint<SketchData | null>("/proxy/llm/sheet/lining_sketch", { brief })
    return result ?? undefined
  } catch (error) {
    console.warn("generateLiningSketch failed, skipping lining:", error)
    return undefined
  }
}

export async function generateProductionPackageData(brief: DesignBrief): Promise<TechPack> {
  try {
    return await postSheetEndpoint<TechPack>("/proxy/llm/sheet/tech_pack", { brief })
  } catch (error) {
    console.error("generateProductionPackageData failed, using placeholder:", error)
    return {
      ...DEFAULT_TECH_PACK,
      description: `Placeholder tech pack for: ${brief.description || "Untitled look"}`,
    }
  }
}

export async function generateCostEstimation(brief: DesignBrief, techPack: TechPack): Promise<CostEstimation> {
  try {
    return await postSheetEndpoint<CostEstimation>("/proxy/llm/sheet/cost_estimation", {
      brief,
      techPack,
    })
  } catch (error) {
    console.error("generateCostEstimation failed, using placeholder:", error)
    return DEFAULT_COST
  }
}

// Helper for local saving parity
export function buildPlaceholderProject(prompt: string): ProjectData {
  return {
    prompt,
    visualConcepts: [buildPlaceholderVisual(prompt, 1)],
    technicalSketches: {
      front: buildSketch("front"),
      back: buildSketch("back"),
      lining: buildSketch("lining"),
    },
    techPack: DEFAULT_TECH_PACK,
    costEstimation: DEFAULT_COST,
  }
}
