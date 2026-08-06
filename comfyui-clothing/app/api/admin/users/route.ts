import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")
  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")
  const page = searchParams.get("page") || "1"
  const pageSize = searchParams.get("page_size") || "20"

  const url = new URL(`${TENANT_API_BASE}/admin/users`)
  if (search) url.searchParams.set("search", search)
  url.searchParams.set("page", page)
  url.searchParams.set("page_size", pageSize)

  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: token } : {}),
    },
    cache: "no-store",
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")
  const body = await request.json().catch(() => ({}))
  const res = await fetch(`${TENANT_API_BASE}/admin/db/users`, {
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
