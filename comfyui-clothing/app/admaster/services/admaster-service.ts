"use client"

import { AdAsset, ProductAnalysis } from "../types"

type ProductSourceInput = string | string[]

const SYSTEM_PROMPT =
  "You are a precise visual design assistant. Follow the user's instructions exactly and return only the requested output."

const normalizeSourceImages = (input: ProductSourceInput): string[] => {
  const items = Array.isArray(input) ? input : [input]
  return items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 4)
}

const isInlineDataUrl = (value: string): boolean => value.startsWith("data:image/")

const buildChatRequestBody = (prompt: string, images: ProductSourceInput): Record<string, unknown> => {
  const normalizedImages = normalizeSourceImages(images)
  const inlineImages = normalizedImages.filter(isInlineDataUrl)
  const imageRefs = normalizedImages.filter((item) => !isInlineDataUrl(item))

  const userContent =
    inlineImages.length > 0
      ? [
          { type: "text", text: prompt },
          ...inlineImages.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : prompt

  const body: Record<string, unknown> = {
    model: "gemini-3-flash-preview",
    debug: true,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  }

  if (imageRefs.length > 0) {
    body.imageRefs = imageRefs
  }

  return body
}

const extractJson = <T>(raw: string): T => {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]) as T
    }
    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T
    }
    throw new Error("Failed to parse JSON response from text model")
  }
}

const callTenantTextModelWithImage = async (
  prompt: string,
  imageSource: string,
  signal?: AbortSignal,
): Promise<string> => {
  const token =
    (typeof window !== "undefined" && (localStorage.getItem("token") || localStorage.getItem("auth_token"))) || ""
  const response = await fetch("/api/proxy/llm/poloapi/chat", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatRequestBody(prompt, imageSource)),
    signal,
    credentials: "include",
  })

  const data = (await response.json().catch(() => ({}))) as { text?: string; detail?: string }
  if (!response.ok) {
    throw new Error(data.detail || "Some generated content did not pass moderation. Please retry.")
  }
  if (!data.text || typeof data.text !== "string") {
    throw new Error("Text model returned empty content")
  }
  return data.text
}

const callTenantTextModelWithImages = async (
  prompt: string,
  images: ProductSourceInput,
  signal?: AbortSignal,
): Promise<string> => {
  const normalizedImages = normalizeSourceImages(images)
  if (normalizedImages.length === 0) {
    throw new Error("At least one product image is required")
  }
  const token =
    (typeof window !== "undefined" && (localStorage.getItem("token") || localStorage.getItem("auth_token"))) || ""
  const response = await fetch("/api/proxy/llm/poloapi/chat", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatRequestBody(prompt, normalizedImages)),
    signal,
    credentials: "include",
  })

  const data = (await response.json().catch(() => ({}))) as { text?: string; detail?: string }
  if (!response.ok) {
    throw new Error(data.detail || "Some generated content did not pass moderation. Please retry.")
  }
  if (!data.text || typeof data.text !== "string") {
    throw new Error("Text model returned empty content")
  }
  return data.text
}

export const generateImageCampaign = async (
  imageBase64: string,
  onProgress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ analysis: ProductAnalysis; assets: AdAsset[] }> => {
  onProgress("Generating video prompt...")

  const styleContext = "Photorealistic premium commercial style, balancing motion clarity and elegant lighting."

  const promptRequest = `Act as a Global Creative Director. Create 1 distinct commercial photography prompt.
GUIDELINES:
NO AI-LOOK: Focus on photorealistic, RAW photo, natural skin texture, authentic physics.
MODEL INTERACTION: The human model MUST be wearing, holding, or using the product naturally.
PHYSICS: Emphasize realistic hair flyaways, dust, or environment interaction.
STYLE: ${styleContext}
PROMPTS NEEDED (reference scenes):
- Epic Hero: Wide cinematic shot, model integrated into a grand environment.
- Kinetic Energy: Extreme action shot, frozen moment of explosive power/movement.
- Urban Luxury: Sophisticated lifestyle moment in a high-end city or architectural context.
- Studio Portrait: Mid-shot focusing on model persona and product interaction.
- Structural Motion: Artistic silhouette or dynamic movement focusing on form and shadow.
- Organic Moment: A candid-style high-end shot of the model in a natural interaction with the product.
Based on the uploaded image, choose the single best scene and output only one prompt for image-to-video generation.
Return strict JSON:
{
  "name": "campaign name",
  "features": ["feature 1", "feature 2"],
  "visualVibe": "brief vibe",
  "targetAudience": "audience",
  "scene": "one of the six scene names",
  "title": "...",
  "prompt": "..."
}`

  const promptText = await callTenantTextModelWithImage(promptRequest, imageBase64, signal)

  const parsed = extractJson<{
    name?: string
    features?: string[]
    visualVibe?: string
    targetAudience?: string
    title?: string
    prompt?: string
  }>(promptText)
  const prompt = (parsed.prompt || "").trim()
  if (!prompt) {
    throw new Error("Text model did not return a usable video prompt")
  }

  const analysis: ProductAnalysis = {
    name: (parsed.name || "Campaign").trim() || "Campaign",
    features: Array.isArray(parsed.features) ? parsed.features : [],
    visualVibe: (parsed.visualVibe || "").trim(),
    targetAudience: (parsed.targetAudience || "").trim(),
    gender: "unisex",
    category: "",
    suggestedLocations: [],
  }

  return {
    analysis,
    assets: [
      {
        id: Math.random().toString(36).slice(2, 11),
        url: imageBase64,
        type: "image",
        title: (parsed.title || "Video Prompt").trim() || "Video Prompt",
        description: prompt,
        isGeneratingVideo: false,
        isRedoing: false,
      },
    ],
  }
}

export type ProductStyle = "ATHLETIC" | "LUXURY"
type PromptGenerationOptions = {
  modelCount?: number
}
export type ProductImageSubmitResult = {
  taskId: string
  imageUrl: string
  thumbnailUrl?: string
}

const STYLE_CONTEXT: Record<ProductStyle, string> = {
  ATHLETIC:
    "Nike/Adidas style: Authentic sweat, high-shutter speed (1/8000s), frozen motion physics, realistic dust particles, natural hair movement, intense athletic focus, urban grit, high-contrast stadium lighting.",
  LUXURY:
    "Hermes/Prada style: Cinematic luxury, architectural soft lighting, quiet luxury, minimalist high-fashion location, natural skin textures, sophisticated material grain, shallow depth of field, elegant color grading.",
}

const resolveStyleContext = (styleInput?: ProductStyle | string | null): string => {
  const trimmed = typeof styleInput === "string" ? styleInput.trim() : ""
  const normalized = trimmed.toUpperCase()
  if (normalized === "ATHLETIC" || normalized === "LUXURY") {
    return STYLE_CONTEXT[normalized as ProductStyle]
  }
  if (trimmed.length > 0) {
    return `Custom style direction from user: ${trimmed}`
  }
  return "Auto style from image: infer the most suitable commercial visual style from the uploaded product image and keep it consistent across all scenes."
}

const callTenantTextModelWithImageForJson = async <T>(
  prompt: string,
  imageBase64: string,
  signal?: AbortSignal,
): Promise<T> => {
  const text = await callTenantTextModelWithImage(prompt, imageBase64, signal)
  return extractJson<T>(text)
}

const callTenantTextModelWithImagesForJson = async <T>(
  prompt: string,
  images: ProductSourceInput,
  signal?: AbortSignal,
): Promise<T> => {
  const text = await callTenantTextModelWithImages(prompt, images, signal)
  return extractJson<T>(text)
}

export const generateProductAnalysis = async (
  imageBase64: ProductSourceInput,
  signal?: AbortSignal,
): Promise<ProductAnalysis> => {
  const sourceImages = normalizeSourceImages(imageBase64)
  const analysisPrompt = `You are a world-class creative director and location scout. Analyze these uploaded product images. The images may show multiple angles/details of the same product.
1. Define a powerful campaign name.
2. Identify key aesthetic and functional features.
3. Describe the "Visual Vibe" using professional photography terms.
4. Identify the elite target audience.
5. Identify the product gender as exactly one of: "male", "female", "unisex".
6. Identify the product category.
7. Suggest exactly 3 cinematic campaign locations that fit this product's function, climate, and style.
Rules:
- If multiple images are provided, treat them as a single reference set.
- Preserve functional logic. Winter gear belongs in alpine/snow contexts, swim products in warm settings, etc.
- Keep the result commercially specific, not generic.
Return strict JSON:
{
  "name": "campaign name",
  "features": ["feature 1", "feature 2"],
  "visualVibe": "visual vibe",
  "targetAudience": "target audience",
  "gender": "male",
  "category": "category",
  "suggestedLocations": [
    { "name": "location", "description": "description", "reasoning": "reason" }
  ]
}`

  const parsed = await callTenantTextModelWithImageForJson<{
    name?: string
    features?: string[]
    visualVibe?: string
    targetAudience?: string
    gender?: "male" | "female" | "unisex"
    category?: string
    suggestedLocations?: Array<{ name?: string; description?: string; reasoning?: string }>
  }>(analysisPrompt, sourceImages[0] || "", signal)

  const fallbackParsed =
    sourceImages.length > 1
      ? await callTenantTextModelWithImagesForJson<{
          name?: string
          features?: string[]
          visualVibe?: string
          targetAudience?: string
          gender?: "male" | "female" | "unisex"
          category?: string
          suggestedLocations?: Array<{ name?: string; description?: string; reasoning?: string }>
        }>(analysisPrompt, sourceImages, signal)
      : parsed

  return {
    name: (fallbackParsed.name || parsed.name || "Campaign").trim() || "Campaign",
    features: Array.isArray(fallbackParsed.features)
      ? fallbackParsed.features
      : Array.isArray(parsed.features)
        ? parsed.features
        : [],
    visualVibe: (fallbackParsed.visualVibe || parsed.visualVibe || "").trim(),
    targetAudience: (fallbackParsed.targetAudience || parsed.targetAudience || "").trim(),
    gender:
      fallbackParsed.gender === "male" || fallbackParsed.gender === "female" || fallbackParsed.gender === "unisex"
        ? fallbackParsed.gender
        : parsed.gender === "male" || parsed.gender === "female" || parsed.gender === "unisex"
          ? parsed.gender
          : "unisex",
    category: (fallbackParsed.category || parsed.category || "").trim(),
    suggestedLocations: Array.isArray(fallbackParsed.suggestedLocations)
      ? fallbackParsed.suggestedLocations
          .map((item) => ({
            name: (item?.name || "").trim(),
            description: (item?.description || "").trim(),
            reasoning: (item?.reasoning || "").trim(),
          }))
          .filter((item) => item.name && item.description && item.reasoning)
          .slice(0, 3)
      : [],
  }
}

export const generateProductImagePrompts = async (
  imageBase64: ProductSourceInput,
  analysis: ProductAnalysis,
  style?: ProductStyle | string | null,
  optionsOrSignal?: PromptGenerationOptions | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<string[]> => {
  const sourceImages = normalizeSourceImages(imageBase64)
  const options =
    optionsOrSignal && !(optionsOrSignal instanceof AbortSignal) ? optionsOrSignal : ({} as PromptGenerationOptions)
  const signal =
    optionsOrSignal instanceof AbortSignal ? optionsOrSignal : maybeSignal
  const styleContext = resolveStyleContext(style)
  const modelCount = Math.max(0, Math.min(4, options.modelCount ?? 1))
  const locationsContext =
    analysis.suggestedLocations.length > 0
      ? analysis.suggestedLocations
          .map(
            (item, index) =>
              `LOCATION ${index + 1}: ${item.name}. DESCRIPTION: ${item.description}. REASONING: ${item.reasoning}.`,
          )
          .join("\n")
      : "Infer four campaign locations that logically match the product's use-case."
  const modelLogic = `MODEL LOGIC:
- Product gender: ${analysis.gender || "unisex"}.
- If the product is meant to be worn/used by a model, keep the styling coherent with the campaign.
- If multiple models appear, they must interact naturally and feel part of the same scene.
- The product must remain the sole hero product. Do not invent extra hero accessories.`
  const prompt = `Act as a Global Creative Director. Create exactly 4 distinct blockbuster commercial photography prompts for a campaign titled '${analysis.name}'.

ANALYSIS CONTEXT:
- Category: ${analysis.category || "Unknown"}
- Features: ${(analysis.features || []).join(", ") || "Not specified"}
- Visual vibe: ${analysis.visualVibe || "Not specified"}
- Target audience: ${analysis.targetAudience || "Not specified"}
- Reference image count: ${sourceImages.length}
- Style direction: ${styleContext}

MANDATORY RULES:
- SOLE HERO PRODUCT: Only showcase the product from the reference images.
- PRODUCT CONSISTENCY: Preserve the product's color, shape, material, and design exactly.
- NO HALLUCINATED ACCESSORIES: Do not add prominent bags, props, or extra products unless they are minor scene props.
- NO SPLIT SCREEN: Every prompt must describe a single unified cinematic frame.
- NO AI LOOK: Use photorealistic RAW advertising photography with natural lighting and believable physics.
- CONTEXT MATCHING: Environments and poses must match the product's function and climate.
- CAMERA DIVERSITY: Vary framing and camera angle across the 4 prompts.
${modelLogic}
- Requested model count: ${modelCount}

LOCATION GUIDANCE:
${locationsContext}

SCENE PLAN:
- Generate exactly 4 prompts.
- Make all 4 prompts clearly different from one another.
- For LUXURY style, mix 2 indoor daylight scenes and 2 outdoor natural-light scenes.
- For ATHLETIC style, favor outdoor action/lifestyle scenes that fit the product.

Return strict JSON:
{
  "imagePrompts": [
    {"title":"...", "prompt":"..."},
    {"title":"...", "prompt":"..."},
    {"title":"...", "prompt":"..."},
    {"title":"...", "prompt":"..."}
  ]
}`

  const parsed = await callTenantTextModelWithImageForJson<{
    imagePrompts?: Array<{ title?: string; prompt?: string }>
  }>(prompt, sourceImages[0] || "", signal)

  const fallbackParsed =
    sourceImages.length > 1
      ? await callTenantTextModelWithImagesForJson<{
          imagePrompts?: Array<{ title?: string; prompt?: string }>
        }>(prompt, sourceImages, signal)
      : parsed

  const prompts = Array.isArray(fallbackParsed.imagePrompts)
    ? fallbackParsed.imagePrompts
        .map((item) => (item?.prompt || "").trim())
        .filter((item) => item.length > 0)
    : []

  return prompts.slice(0, 4)
}

const buildImageRenderPrompt = (prompt: string): string =>
  `PROFESSIONAL ADVERTISING PHOTOGRAPHY. 8k resolution, RAW style, highly detailed.
${prompt}
The model MUST wear/use the product from the reference.
Authentic physical lighting, natural textures, absolutely NO over-smoothing or plastic AI look.`

type PoloapiTaskStatus = {
  status?: string
  errorMessage?: string
  storagePaths?: Array<{
    original?: string
    localPath?: string
    thumbnail?: string
    thumbnailPath?: string
  }>
}

const getPoloapiTaskStatus = async (taskId: string, signal?: AbortSignal): Promise<PoloapiTaskStatus> => {
  const response = await fetch(`/api/proxy/poloapi/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    signal,
    credentials: "include",
  })
  const data = (await response.json().catch(() => ({}))) as {
    detail?: string
    status?: string
    errorMessage?: string
    storagePaths?: PoloapiTaskStatus["storagePaths"]
  }
  if (!response.ok) {
    throw new Error(data.detail || "Failed to query poloapi task")
  }
  return data
}

const waitForPoloapiTaskResult = async (
  taskId: string,
  signal?: AbortSignal,
  maxAttempts: number = 120,
  intervalMs: number = 2500,
): Promise<PoloapiTaskStatus> => {
  let attempts = 0
  while (attempts < maxAttempts) {
    const data = await getPoloapiTaskStatus(taskId, signal)
    const status = String(data.status || "PENDING").toUpperCase()
    if (status === "SUCCESS" || status === "COMPLETED") return data
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(data.errorMessage || "PoloAPI image task failed")
    }
    attempts += 1
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error("PoloAPI image task polling timeout")
}

export const submitProductImageTasks = async (
  imageBase64: string,
  prompts: string[],
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<{ submitted: number; failed: number; tenantTaskIds: string[]; results: ProductImageSubmitResult[] }> => {
  const imageBlob = await fetch(imageBase64, { signal }).then((res) => res.blob())
  let finished = 0
  onProgress(0)

  const toProxyImageUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    if (raw.startsWith("/api/proxy/static/images/")) return raw
    const normalized = raw.replace(/\\/g, "/")
    const marker = "/output/"
    const markerIndex = normalized.lastIndexOf(marker)
    if (markerIndex >= 0) {
      const relative = normalized.slice(markerIndex + marker.length)
      return relative ? `/api/proxy/static/images/${relative}` : null
    }
    if (normalized.startsWith("output/")) {
      return `/api/proxy/static/images/${normalized.slice("output/".length)}`
    }
    return null
  }

  const jobs = prompts.map(async (prompt, idx) => {
    const formData = new FormData()
    formData.append("prompt", buildImageRenderPrompt(prompt))
    formData.append("file", imageBlob, `source_${idx + 1}.png`)
    formData.append("async_mode", "true")

    const response = await fetch("/api/proxy/complete_image_edit_poloapi", {
      method: "POST",
      body: formData,
      signal,
      credentials: "include",
    })
    const data = (await response.json().catch(() => ({}))) as {
      detail?: string
      tenantTaskId?: string
      tenant_task_id?: string
      storagePaths?: Array<{
        original?: string
        localPath?: string
        thumbnail?: string
        thumbnailPath?: string
      }>
    }
    if (!response.ok) {
      throw new Error(data.detail || `Failed to submit image task ${idx + 1}`)
    }
    const taskId = data.tenantTaskId || data.tenant_task_id
    if (!taskId) {
      throw new Error(`Image task ${idx + 1} missing tenant task id`)
    }
    const statusData =
      Array.isArray(data.storagePaths) && data.storagePaths.length > 0
        ? { storagePaths: data.storagePaths }
        : await waitForPoloapiTaskResult(taskId, signal)
    const firstStorage = Array.isArray(statusData.storagePaths) ? statusData.storagePaths[0] : null
    const imageUrl = toProxyImageUrl(firstStorage?.original || firstStorage?.localPath)
    const thumbnailUrl = toProxyImageUrl(firstStorage?.thumbnail || firstStorage?.thumbnailPath) || undefined
    if (!imageUrl) {
      throw new Error(`Image task ${idx + 1} missing image url`)
    }
    finished += 1
    onProgress(Math.min(1, finished / prompts.length))
    const result: ProductImageSubmitResult = { taskId, imageUrl }
    if (thumbnailUrl) {
      result.thumbnailUrl = thumbnailUrl
    }
    return result
  })

  const settled = await Promise.allSettled(jobs)
  const results = settled
    .filter((item): item is PromiseFulfilledResult<ProductImageSubmitResult> => item.status === "fulfilled")
    .map((item) => item.value)
  const tenantTaskIds = results.map((item) => item.taskId)
  const failed = settled.length - tenantTaskIds.length

  return { submitted: tenantTaskIds.length, failed, tenantTaskIds, results }
}

export const renderVideoForImage = async (
  imageAsset: AdAsset,
  analysis: ProductAnalysis,
  signal?: AbortSignal,
): Promise<string> => {
  const sourceResponse = await fetch(imageAsset.url, { signal })
  const imageBlob = await sourceResponse.blob()

  const formData = new FormData()
  formData.append("prompt", `Cinematic commercial film sequence for "${analysis.name}". ${imageAsset.description}.`)
  formData.append("file", imageBlob, "source.png")

  const response = await fetch("/api/proxy/admaster/sora2", {
    method: "POST",
    body: formData,
    signal,
    credentials: "include",
  })

  const data = (await response.json().catch(() => ({}))) as { detail?: string; video_url?: string }
  if (!response.ok) {
    throw new Error(data.detail || "Video generation failed")
  }
  const taskId = (data as any)?.task_id as string | undefined
  if (!taskId) {
    throw new Error("Video task submit failed: empty task id")
  }
  return taskId
}

export const getVideoTaskStatus = async (
  taskId: string,
): Promise<{ status: string; video_url?: string; error?: string; progress?: number }> => {
  const response = await fetch(`/api/proxy/admaster/sora2/${encodeURIComponent(taskId)}`, {
    method: "GET",
    credentials: "include",
  })

  const data = (await response.json().catch(() => ({}))) as {
    detail?: string
    status?: string
    video_url?: string
    error?: string
    progress?: number
  }
  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch video task status")
  }

  return {
    status: (data.status || "queued").toLowerCase(),
    video_url: data.video_url,
    error: data.error,
    progress: data.progress,
  }
}

export const getSubmittedVideoTasks = async (
): Promise<Array<{ task_id: string; status: string; video_url?: string; error?: string; created_at?: string }>> => {
  const response = await fetch("/api/proxy/admaster/sora2/tasks", {
    method: "GET",
    credentials: "include",
  })
  const data = (await response.json().catch(() => ({}))) as {
    detail?: string
    tasks?: Array<{ task_id?: string; status?: string; video_url?: string; error?: string; created_at?: string }>
  }
  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch submitted tasks")
  }
  return Array.isArray(data.tasks)
    ? data.tasks
        .filter((item) => !!item?.task_id)
        .map((item) => ({
          task_id: String(item.task_id),
          status: String(item.status || "queued").toLowerCase(),
          video_url: item.video_url,
          error: item.error,
          created_at: item.created_at,
        }))
    : []
}
