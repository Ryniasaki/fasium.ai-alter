import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../proxy/utils"

export async function GET(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) return authHeader

  const { search } = new URL(request.url)
  const targetUrl = `${TENANT_API_BASE}/admin/stats/usage${search || ""}`
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
    cache: "no-store",
  })

  return relayResponse(response)
}
