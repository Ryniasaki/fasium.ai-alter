import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

type RouteParams = {
  params: {
    table: string
    recordId: string
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const token = request.headers.get("authorization")
  const body = await request.json().catch(() => ({}))
  const url = `${TENANT_API_BASE}/admin/db/${params.table}/${params.recordId}`
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.headers.get("authorization")
  const url = `${TENANT_API_BASE}/admin/db/${params.table}/${params.recordId}`
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
