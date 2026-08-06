import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../../../utils"

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: { projectId: string; inviteId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const rawBody = await request.text()

  const response = await fetch(
    `${TENANT_API_BASE}/proxy/projects/${params.projectId}/team/invites/${params.inviteId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: rawBody || undefined,
    },
  )

  return relayResponse(response)
}
