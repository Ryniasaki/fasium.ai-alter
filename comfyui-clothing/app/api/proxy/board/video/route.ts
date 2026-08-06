import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../utils"

export async function POST(request: NextRequest) {
  try {
    const authHeader = requireAuthHeader(request)
    if (authHeader instanceof NextResponse) {
      return authHeader
    }

    const formData = await request.formData()
    const response = await fetch(`${TENANT_API_BASE}/proxy/board/video/submit`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    })

    return relayResponse(response)
  } catch (error) {
    console.error("Board video proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
