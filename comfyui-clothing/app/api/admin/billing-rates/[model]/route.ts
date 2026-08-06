import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function DELETE(request: NextRequest, { params }: { params: { model: string } }) {
  const token = request.headers.get("authorization")
  const model = params.model
  const url = `${TENANT_API_BASE}/admin/billing-rates/${encodeURIComponent(model)}`
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
