import { NextRequest, NextResponse } from "next/server"

import { toolCatalog } from "@/lib/tools/catalog"

const TENANT_API_BASE = process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081"

const toolContextText = toolCatalog
  .map(
    (tool, index) =>
      `${index + 1}. ${tool.displayName} (${tool.href}) - ${tool.description} | 适用: ${tool.focus} | 影响: ${tool.impact}`,
  )
  .join("\n")

const SYSTEM_PROMPT = `你是 Fasium 的工具调度员。根据用户问题，从下列工具中挑选最合适的调用顺序（1-3 个），并指出理由与所需输入。

工具列表：
${toolContextText}

输出 JSON，格式如下：
{
  "summary": "先给2句话概括推荐思路",
  "recommendations": [
    {
      "displayName": "工具展示名",
      "href": "/extract",
      "why": "为什么选它，与用户问题的关系",
      "requiredInputs": ["必备输入1", "可选输入2"],
      "callSteps": ["步骤1", "步骤2"]
    }
  ],
  "followup": ["可供询问的补充问题，最多2个"]
}
仅使用上方列表中的工具，不要捏造新工具。`

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ detail: "Authorization header required" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const question = body?.question?.toString().trim()
    if (!question) {
      return NextResponse.json({ detail: "question is required" }, { status: 400 })
    }

    const payload = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `用户问题：${question}\n请根据工具列表给出最合适的调用建议。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }

    const response = await fetch(`${TENANT_API_BASE}/proxy/llm/gemini/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
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
      return NextResponse.json(data ?? { detail: "LLM request failed" }, { status: response.status })
    }

    const content = data?.choices?.[0]?.message?.content ?? text
    let parsed = null
    if (typeof content === "string") {
      try {
        parsed = JSON.parse(content)
      } catch {
        parsed = null
      }
    } else if (content) {
      parsed = content
    }

    return NextResponse.json({
      recommendations: parsed ?? { raw: content ?? data },
      raw: content ?? data,
    })
  } catch (error) {
    console.error("chatbot recommend error", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
