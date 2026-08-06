import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 }
      );
    }

    // Forward multipart form (file + prompt) to tenant
    const formData = await request.formData();
    const response = await fetch(`${TENANT_API_BASE}/proxy/llm/palette_from_image`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData as any,
    });

    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null } catch { /* ignore */ }

    if (!response.ok) {
      return NextResponse.json(
        data ?? { detail: "Palette request failed" },
        { status: response.status }
      );
    }

    // Accept raw JSON string or object
    if (data) return NextResponse.json(data);
    return new NextResponse(text || "{}", { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("LLM palette proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}

