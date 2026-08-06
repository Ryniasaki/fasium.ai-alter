import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/models/lora`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
      cache: "no-store",
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Failed to fetch lora records" }, { status: response.status })
    }
    return NextResponse.json(data ?? { items: [] })
  } catch (error) {
    console.error("Failed to fetch lora records:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const response = await fetch(`${TENANT_API_BASE}/models/lora`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Failed to create lora record" }, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to create lora record:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
