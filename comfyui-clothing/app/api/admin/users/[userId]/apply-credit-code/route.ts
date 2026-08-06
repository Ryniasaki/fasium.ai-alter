import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  const token = request.headers.get("authorization")
  const body = await request.json().catch(() => ({}))
  const url = `${TENANT_API_BASE}/admin/users/${params.userId}/apply-credit-code`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
