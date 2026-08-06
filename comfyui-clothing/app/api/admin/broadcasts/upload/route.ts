import { NextRequest } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "@/app/api/proxy/utils"

export async function POST(request: NextRequest) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const formData = await request.formData()
  const response = await fetch(`${TENANT_API_BASE}/admin/broadcasts/upload`, {
    method: "POST",
    headers: { Authorization: auth },
    body: formData,
  })
  return relayResponse(response)
}
