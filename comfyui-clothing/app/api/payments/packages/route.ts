import { NextRequest } from "next/server"
import { TENANT_API_BASE, relayResponse, requireAuthHeader } from "@/app/api/proxy/utils"

export async function GET(request: NextRequest) {
  const authHeader = requireAuthHeader(request)
  if (typeof authHeader !== "string") {
    return authHeader
  }

  const provider = request.nextUrl.searchParams.get("provider")
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : ""
  const response = await fetch(`${TENANT_API_BASE}/payments/packages${query}`, {
    headers: {
      authorization: authHeader,
    },
    cache: "no-store",
  })
  return relayResponse(response)
}
