import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

interface RouteContext {
  params: { loraId?: string }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  const loraId = context.params?.loraId
  if (!loraId) {
    return NextResponse.json({ detail: "lora_id is required" }, { status: 400 })
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/models/lora/${encodeURIComponent(loraId)}/preview`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Failed to generate preview" }, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to generate lora preview:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
