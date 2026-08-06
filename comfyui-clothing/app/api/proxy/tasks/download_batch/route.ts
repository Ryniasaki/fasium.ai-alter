import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader } from "../../utils"

export async function POST(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 })
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/proxy/tasks/download_batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      let data: unknown = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
      }
      const errorBody =
        data && typeof data === "object"
          ? data
          : { detail: text || `Tenant service returned ${response.status}` }
      return NextResponse.json(errorBody, { status: response.status })
    }

    const arrayBuffer = await response.arrayBuffer()
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=batch-download.zip",
      },
    })
  } catch (error) {
    console.error("Download batch proxy failed:", error)
    return NextResponse.json({ detail: "Failed to download batch" }, { status: 502 })
  }
}
