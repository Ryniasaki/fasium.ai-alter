import { NextRequest, NextResponse } from "next/server"
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
  requireAuthHeader,
} from "../../../utils"

async function relay(
  request: NextRequest,
  params: { projectId: string },
  method: "GET" | "POST" | "DELETE",
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const body = method === "GET" ? undefined : await request.text()

  try {
    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/projects/${params.projectId}/tasks`,
      {
        method,
        headers: {
          Authorization: authHeader,
          ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        },
        body: body && body.length > 0 ? body : undefined,
        cache: method === "GET" ? "no-store" : undefined,
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
        data ?? { detail: text || "Project tasks request failed" },
        { status: response.status },
      )
    }

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("Project tasks proxy error:", error)
    if (method === "GET") {
      return NextResponse.json({ tasks: [] })
    }
    return NextResponse.json(
      { detail: "Project tasks request failed" },
      { status: 503 },
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  return relay(request, params, "GET")
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  return relay(request, params, "POST")
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  return relay(request, params, "DELETE")
}
