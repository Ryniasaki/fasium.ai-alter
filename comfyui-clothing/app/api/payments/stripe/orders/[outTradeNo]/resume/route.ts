import { NextRequest } from "next/server"
import { requireAuthHeader, TENANT_API_BASE, relayResponse } from "@/app/api/proxy/utils"

export async function POST(
  request: NextRequest,
  { params }: { params: { outTradeNo: string } },
) {
  const authHeader = requireAuthHeader(request)
  if (typeof authHeader !== "string") {
    return authHeader
  }

  const response = await fetch(
    `${TENANT_API_BASE}/payments/stripe/orders/${encodeURIComponent(params.outTradeNo)}/resume`,
    {
      method: "POST",
      headers: {
        authorization: authHeader,
      },
    },
  )
  return relayResponse(response)
}
