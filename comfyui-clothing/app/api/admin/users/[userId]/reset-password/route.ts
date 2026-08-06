import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

type RouteParams = {
  params: {
    userId: string
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.headers.get("authorization")
  const res = await fetch(`${TENANT_API_BASE}/admin/users/${params.userId}/reset-password`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
