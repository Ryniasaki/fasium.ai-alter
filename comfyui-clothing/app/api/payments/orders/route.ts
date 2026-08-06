import { NextRequest } from "next/server"
import { requireAuthHeader, TENANT_API_BASE, relayResponse } from "@/app/api/proxy/utils"

export async function GET(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (typeof authHeader !== "string") {
    return authHeader
  }

  const response = await fetch(`${TENANT_API_BASE}/payments/orders`, {
    headers: {
      authorization: authHeader,
    },
    cache: "no-store",
  })
  return relayResponse(response)
}
