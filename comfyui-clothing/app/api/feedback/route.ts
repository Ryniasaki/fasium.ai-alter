import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

function resolveAuthHeader(request: NextRequest) {
  return (
    request.headers.get("authorization") ||
    (request.cookies.get("access_token")?.value
      ? `Bearer ${request.cookies.get("access_token")?.value}`
      : null)
  )
}

export async function GET(request: NextRequest) {
  const authHeader = resolveAuthHeader(request)
  if (!authHeader) {
    return NextResponse.json(
      { detail: "Authorization header required" },
      { status: 401 },
    )
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/feedback`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? {}, { status: response.status })
  } catch (error) {
    console.error("Feedback GET proxy error:", error)
    return NextResponse.json(
      { detail: "Failed to load feedback" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const authHeader = resolveAuthHeader(request)
  if (!authHeader) {
    return NextResponse.json(
      { detail: "Authorization header required" },
      { status: 401 },
    )
  }

  try {
    const formData = await request.formData()

    const response = await fetch(`${TENANT_API_BASE}/feedback`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? {}, { status: response.status })
  } catch (error) {
    console.error("Feedback POST proxy error:", error)
    return NextResponse.json(
      { detail: "Failed to submit feedback" },
      { status: 500 },
    )
  }
}
