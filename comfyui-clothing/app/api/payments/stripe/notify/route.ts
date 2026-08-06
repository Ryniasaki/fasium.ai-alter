import { TENANT_API_BASE } from "@/app/api/proxy/utils"

export async function POST(request: Request) {
  const body = await request.arrayBuffer()
  const response = await fetch(`${TENANT_API_BASE}/payments/stripe/notify`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json",
      "stripe-signature": request.headers.get("stripe-signature") || "",
    },
    body,
    cache: "no-store",
  })

  const text = await response.text()
  return new Response(text || "{}", {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    },
  })
}
