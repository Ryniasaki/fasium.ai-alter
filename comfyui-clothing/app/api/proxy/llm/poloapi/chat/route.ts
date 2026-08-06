import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 },
      )
    }

    const body = await request.text()

    const response = await fetch(`${TENANT_API_BASE}/proxy/llm/poloapi/chat_messages`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: body || "{}",
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Request failed" }, { status: response.status })
    }

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("PoloAPI chat proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
