import { NextRequest, NextResponse } from "next/server"
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
} from "../../../utils"

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 },
      )
    }

    const { searchParams } = new URL(request.url)
    const forwardedParams = new URLSearchParams()

    for (const [key, value] of searchParams.entries()) {
      if (value) {
        forwardedParams.set(key, value)
      }
    }

    const queryString = forwardedParams.toString()
    const targetUrl = `${TENANT_API_BASE}/proxy/tasks/history/count${
      queryString ? `?${queryString}` : ""
    }`

    const response = await fetchTenantWithTimeout(targetUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    }, TENANT_REQUEST_TIMEOUT_MS)

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Get task history count proxy error:", error)
    return NextResponse.json({ total: 0 })
  }
}
