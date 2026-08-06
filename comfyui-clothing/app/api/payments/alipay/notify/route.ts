import { TENANT_API_BASE } from "@/app/api/proxy/utils"

export async function POST(request: Request) {
  const body = await request.text()
  const response = await fetch(`${TENANT_API_BASE}/payments/alipay/notify`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  })

  const text = await response.text()
  return new Response(text || "failure", {
    status: response.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  })
}
