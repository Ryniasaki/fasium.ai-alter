import { NextRequest } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "@/app/api/proxy/utils"

export async function GET(request: NextRequest) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const response = await fetch(`${TENANT_API_BASE}/proxy/broadcasts/active`, {
    headers: { Authorization: auth },
    cache: "no-store",
  })
  return relayResponse(response)
}
