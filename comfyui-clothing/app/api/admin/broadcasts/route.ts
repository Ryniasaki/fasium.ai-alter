import { NextRequest } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "@/app/api/proxy/utils"

export async function GET(request: NextRequest) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const response = await fetch(`${TENANT_API_BASE}/admin/broadcasts`, {
    headers: { Authorization: auth },
    cache: "no-store",
  })
  return relayResponse(response)
}

export async function POST(request: NextRequest) {
  const auth = requireAuthHeader(request)
  if (auth instanceof Response) return auth

  const body = await request.json().catch(() => ({}))
  const response = await fetch(`${TENANT_API_BASE}/admin/broadcasts`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return relayResponse(response)
}
