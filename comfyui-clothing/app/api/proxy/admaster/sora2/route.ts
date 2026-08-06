import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../utils"

export async function POST(request: NextRequest) {
  try {
    const authHeader = requireAuthHeader(request)
    if (authHeader instanceof NextResponse) {
      return authHeader
    }

    const formData = await request.formData()
    const response = await fetch(`${TENANT_API_BASE}/proxy/admaster/sora2/video`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    })

    return relayResponse(response)
  } catch (error) {
    console.error("Admaster sora2 proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const scope = request.nextUrl.searchParams.get("scope")
    if (scope === "tasks") {
      const authHeader = requireAuthHeader(request)
      if (authHeader instanceof NextResponse) {
        return authHeader
      }
      const response = await fetch(`${TENANT_API_BASE}/proxy/admaster/sora2/video/task-list`, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      })
      return relayResponse(response)
    }

    return NextResponse.json(
      { detail: "Use POST to submit task, GET /api/proxy/admaster/sora2/{taskId} for status, or GET /api/proxy/admaster/sora2?scope=tasks for list." },
      { status: 200 },
    )
  } catch (error) {
    console.error("Admaster sora2 GET proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
