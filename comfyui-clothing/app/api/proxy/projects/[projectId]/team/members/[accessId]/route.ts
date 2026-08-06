import { NextRequest, NextResponse } from "next/server"
import { TENANT_API_BASE, requireAuthHeader, relayResponse } from "../../../../../utils"

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; accessId: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (authHeader instanceof NextResponse) {
    return authHeader
  }

  const response = await fetch(
    `${TENANT_API_BASE}/proxy/projects/${params.projectId}/team/members/${params.accessId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
      },
    },
  )

  return relayResponse(response)
}
