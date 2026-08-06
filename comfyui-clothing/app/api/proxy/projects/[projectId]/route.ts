import { NextRequest, NextResponse } from "next/server"
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
  requireAuthHeader,
} from "../../utils"

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects/${params.projectId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: authHeader,
        },
      },
      TENANT_REQUEST_TIMEOUT_MS,
    )

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
      return NextResponse.json(
        data ?? { detail: text || "Delete project failed" },
        { status: response.status },
      )
    }

    return NextResponse.json(data ?? { deleted: true })
  } catch (error) {
    console.error("Delete project proxy error:", error)
    return NextResponse.json(
      { detail: "Delete project failed" },
      { status: 503 },
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const query = request.nextUrl.search
  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects/${params.projectId}${query}`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
        cache: "no-store",
      },
      TENANT_REQUEST_TIMEOUT_MS,
    )

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
      return NextResponse.json(
        data ?? { detail: text || "Get project failed" },
        { status: response.status },
      )
    }

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("Get project proxy error:", error)
    return NextResponse.json({})
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const rawBody = await request.text()

  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects/${params.projectId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: rawBody || undefined,
      },
      TENANT_REQUEST_TIMEOUT_MS,
    )

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
      return NextResponse.json(
        data ?? { detail: text || "Update project failed" },
        { status: response.status },
      )
    }

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("Update project proxy error:", error)
    return NextResponse.json(
      { detail: "Update project failed" },
      { status: 503 },
    )
  }
}
