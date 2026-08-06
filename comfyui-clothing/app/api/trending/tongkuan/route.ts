import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 })
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/reports/trending/generate_tongkuan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }

    if (!response.ok) {
      const errorBody = data && typeof data === "object" ? data : { detail: text || "Generation failed" }
      return NextResponse.json(errorBody, { status: response.status })
    }

    if (data === null) {
      return NextResponse.json({ detail: "Empty response from tenant service" }, { status: 502 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to call tenant generate_tongkuan:", error)
    return NextResponse.json({ detail: "Unable to reach tenant service" }, { status: 502 })
  }
}
