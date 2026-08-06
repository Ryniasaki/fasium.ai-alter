import { NextRequest, NextResponse } from "next/server"
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
  relayResponse,
  requireAuthHeader,
} from "../utils"

export async function GET(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const query = request.nextUrl.search
  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects${query}`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
        cache: "no-store",
      },
      TENANT_REQUEST_TIMEOUT_MS,
    )

    return relayResponse(response)
  } catch (error) {
    console.error("Get projects proxy error:", error)
    return NextResponse.json({ projects: [] })
  }
}

export async function POST(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const rawBody = await request.text()

  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: rawBody || undefined,
      },
      TENANT_REQUEST_TIMEOUT_MS,
    )

    return relayResponse(response)
  } catch (error) {
    console.error("Create projects proxy error:", error)
    return NextResponse.json(
      { detail: "Create project request failed" },
      { status: 503 },
    )
  }
}
