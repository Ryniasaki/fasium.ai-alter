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

    const formData = await request.formData();
    const prompt = formData.get("prompt");
    const file = formData.get("file");

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { detail: "Prompt is required" },
        { status: 400 }
      );
    }

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { detail: "Image file is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${TENANT_API_BASE}/proxy/complete_video_generation`,
      {
        method: "POST",
        headers: { Authorization: authHeader },
        body: formData,
      }
    );

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return NextResponse.json(
        { detail: text || "Unexpected response from tenant service" },
        { status: response.status }
      );
    }

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Complete video generation proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}

