import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

type RouteParams = {
  params: {
    table: string
  }
}

function buildProxyUrl(base: string, request: NextRequest) {
  const target = new URL(base)
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })
  return target.toString()
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.headers.get("authorization")
  const url = buildProxyUrl(`${TENANT_API_BASE}/admin/db/${params.table}`, request)
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
    cache: "no-store",
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.headers.get("authorization")
  const body = await request.json().catch(() => ({}))
  const url = `${TENANT_API_BASE}/admin/db/${params.table}`
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
