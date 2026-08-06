import { NextRequest, NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function PATCH(request: NextRequest, { params }: { params: { loraId: string } }) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  try {
    const payload = await request.json().catch(() => null)
    const response = await fetch(`${TENANT_API_BASE}/models/lora/${params.loraId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload ?? {}),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Failed to update record" }, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to update lora record:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { loraId: string } }) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) {
    return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
  }

  try {
    const response = await fetch(`${TENANT_API_BASE}/models/lora/${params.loraId}`, {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
      },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(data ?? { detail: "Failed to delete record" }, { status: response.status })
    }
    return NextResponse.json(data ?? { detail: "删除成功" })
  } catch (error) {
    console.error("Failed to delete lora record:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
