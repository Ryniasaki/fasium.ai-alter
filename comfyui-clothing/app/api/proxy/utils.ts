import { NextRequest, NextResponse } from "next/server"

export const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"
export const TENANT_REQUEST_TIMEOUT_MS = Number(
  process.env.TENANT_REQUEST_TIMEOUT_MS || "8000",
)
const ACCESS_TOKEN_COOKIE = "access_token"

export function requireAuthHeader(
  request: NextRequest,
): string | NextResponse {
  const authHeader = request.headers.get("authorization")
  if (authHeader) {
    return authHeader
  }

  const cookieToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  if (cookieToken) {
    return `Bearer ${cookieToken}`
  }

  return NextResponse.json(
    { detail: "Authorization header required" },
    { status: 401 },
  )
}

export async function relayResponse(response: Response) {
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
    const errorBody =
      (data && typeof data === "object") || Array.isArray(data)
        ? data
        : { detail: text || "Request failed" }
    return NextResponse.json(errorBody ?? { detail: "Request failed" }, { status: response.status })
  }

  if (data === null) {
    return NextResponse.json({})
  }

  return NextResponse.json(data)
}

export async function fetchTenantWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = TENANT_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, Math.max(1000, timeoutMs))

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
