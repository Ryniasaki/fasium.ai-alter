import { NextRequest } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "@/app/api/proxy/utils"

export async function PATCH(
  request: NextRequest,
  { params }: { params: { broadcastId: string } },
) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const body = await request.json().catch(() => ({}))
  const response = await fetch(`${TENANT_API_BASE}/admin/broadcasts/${params.broadcastId}`, {
    method: "PATCH",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return relayResponse(response)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { broadcastId: string } },
) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const response = await fetch(`${TENANT_API_BASE}/admin/broadcasts/${params.broadcastId}`, {
    method: "DELETE",
    headers: { Authorization: auth },
  })
  return relayResponse(response)
}
