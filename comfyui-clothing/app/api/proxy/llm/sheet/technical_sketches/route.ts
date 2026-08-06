import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
    }

    const payload = await request.json()
    const response = await fetch(`${TENANT_API_BASE}/proxy/llm/sheet/technical_sketches`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* ignore */
    }

    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Technical sketch request failed" }, { status: response.status })
    }

    if (data) return NextResponse.json(data)
    return new NextResponse(text || "{}", { status: 200, headers: { "Content-Type": "application/json" } })
  } catch (error) {
    console.error("Technical sketch proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}

