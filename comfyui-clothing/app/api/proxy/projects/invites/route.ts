import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../utils"

export async function GET(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const response = await fetch(`${TENANT_API_BASE}/proxy/projects/invites`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
    cache: "no-store",
  })

  return relayResponse(response)
}
