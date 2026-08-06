import { NextResponse } from "next/server"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function GET() {
  try {
    const response = await fetch(`${TENANT_API_BASE}/reports/trending`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to fetch trending reports:", error)
    return NextResponse.json({ detail: "Unable to load reports" }, { status: 500 })
  }
}
