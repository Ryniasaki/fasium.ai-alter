import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const targetPath = params.path?.join("/") ?? ""
  const targetUrl = `${TENANT_API_BASE}/sheet/${targetPath}`

  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
    }

    const payload = await request.text()
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: payload,
    })

    const text = await response.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* ignore non-JSON responses */
    }

    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Sheet proxy request failed" }, { status: response.status })
    }

    if (data) return NextResponse.json(data)
    return new NextResponse(text || "{}", { status: 200, headers: { "Content-Type": "application/json" } })
  } catch (error) {
    console.error("Sheet proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
