import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../utils"

export async function GET(request: NextRequest) {
  try {
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
  } catch (error) {
    console.error("Admaster sora2 task list proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
