import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../utils"

type Params = {
  params: {
    taskId: string
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const authHeader = requireAuthHeader(request)
    if (authHeader instanceof NextResponse) {
      return authHeader
    }

    if (params.taskId === "tasks") {
      const listResponse = await fetch(`${TENANT_API_BASE}/proxy/admaster/sora2/video/task-list`, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      })
      return relayResponse(listResponse)
    }

    const taskId = encodeURIComponent(params.taskId)
    const response = await fetch(`${TENANT_API_BASE}/proxy/admaster/sora2/video/${taskId}`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    })

    return relayResponse(response)
  } catch (error) {
    console.error("Admaster sora2 status proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
