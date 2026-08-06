import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "../../../utils"

export async function POST(request: NextRequest) {
  try {
    const authHeader = requireAuthHeader(request)
    if (authHeader instanceof NextResponse) {
      return authHeader
    }

    const formData = await request.formData()
    const response = await fetch(`${TENANT_API_BASE}/proxy/llm/poloapi/chat`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData as any,
    })
    return relayResponse(response)
  } catch (error) {
    console.error("PoloAPI chat form proxy error:", error)
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 },
    )
  }
}
