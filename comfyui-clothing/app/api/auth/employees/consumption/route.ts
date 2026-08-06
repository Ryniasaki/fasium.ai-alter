import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

function resolveAuthHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader) return authHeader
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  return `Bearer ${token}`
}

export async function GET(request: NextRequest) {
  const authHeader = resolveAuthHeader(request)
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }
  const response = await fetch(`${TENANT_API_BASE}/auth/employees/consumption`, {
    method: "GET",
    headers: { Authorization: authHeader },
    cache: "no-store",
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
    return NextResponse.json(data ?? { detail: text || "Request failed" }, { status: response.status })
  }
  return NextResponse.json(data ?? {})
}
