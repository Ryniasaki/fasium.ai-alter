import { NextRequest } from "next/server"
import { requireAuthHeader, TENANT_API_BASE, relayResponse } from "@/app/api/proxy/utils"

export async function POST(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (typeof authHeader !== "string") {
    return authHeader
  }

  const body = await request.text()
  const response = await fetch(`${TENANT_API_BASE}/payments/stripe/orders`, {
    method: "POST",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    body,
  })
  return relayResponse(response)
}
