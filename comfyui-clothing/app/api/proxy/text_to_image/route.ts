import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

type TextToImagePayload = {
  prompt: string
  aspect_ratio?: "16:9" | "9:16" | "1:1"
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
    }

    let payload: TextToImagePayload
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ detail: "Invalid JSON payload" }, { status: 400 })
    }

    const prompt = payload.prompt?.trim()
    if (!prompt) {
      return NextResponse.json({ detail: "Prompt is required" }, { status: 400 })
    }

    const aspectRatio = payload.aspect_ratio && ["16:9", "9:16", "1:1"].includes(payload.aspect_ratio)
      ? payload.aspect_ratio
      : "16:9"

    const response = await fetch(`${TENANT_API_BASE}/proxy/text_to_image`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspectRatio,
      }),
    })

    const contentType = response.headers.get("content-type") || ""
    const data = contentType.includes("application/json") ? await response.json() : await response.text()

    if (!response.ok) {
      return NextResponse.json(
        typeof data === "string" ? { detail: data || "Tenant service error" } : data,
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Text-to-image proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
