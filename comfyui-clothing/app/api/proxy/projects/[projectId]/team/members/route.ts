import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../../utils"

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const rawBody = await request.text()

  const response = await fetch(
    `${TENANT_API_BASE}/proxy/projects/${params.projectId}/team/members`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: rawBody || undefined,
    },
  )

  return relayResponse(response)
}
