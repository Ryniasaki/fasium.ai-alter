import { NextRequest, NextResponse } from "next/server"

import { toolApps } from "@/lib/tools-catalog"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as
      | {
          question?: unknown
          history?: unknown
          imageDataUrl?: unknown
        }
      | null

    const question = typeof body?.question === "string" ? body?.question.trim() : ""
    const imageDataUrl = typeof body?.imageDataUrl === "string" ? body?.imageDataUrl : undefined
    if (!question && !imageDataUrl) {
      return NextResponse.json({ detail: "question or imageDataUrl is required" }, { status: 400 })
    }

    const history = Array.isArray(body?.history) ? body?.history : undefined

    const payload = {
      question: question || "",
      history,
      image_data_url: imageDataUrl,
      tools: toolApps.map((tool) => ({
        name: tool.name,
        displayName: tool.displayName,
        href: tool.href,
        description: tool.llmDescription || tool.description,
        category: tool.category,
        focus: tool.focus,
        impact: tool.impact,
        status: tool.status,
      })),
    }

    const response = await fetch(`${TENANT_API_BASE}/proxy/agent/tools`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      return NextResponse.json(data ?? { detail: text || "Agent request failed" }, { status: response.status })
    }

    if (data !== null) {
      return NextResponse.json(data, { status: response.status })
    }

    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Agent tools proxy error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
