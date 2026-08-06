import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const markdownPath = params.path.join("/");

    const response = await fetch(
      `${TENANT_API_BASE}/proxy/static/markdown/${markdownPath}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { detail: "Markdown not found" },
        { status: response.status }
      );
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Static markdown proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
