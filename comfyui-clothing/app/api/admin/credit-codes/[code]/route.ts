import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function DELETE(request: NextRequest, { params }: { params: { code: string } }) {
  const token = request.headers.get("authorization")
  const code = params.code
  const url = `${TENANT_API_BASE}/admin/credit-codes/${encodeURIComponent(code)}`
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
