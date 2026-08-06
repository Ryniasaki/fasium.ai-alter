import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 },
      );
    }

    const targetUrl = `${TENANT_API_BASE}/proxy/tasks/types`;

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { detail: "Failed to fetch task types" },
        { status: response.status },
      );
    }

    return NextResponse.json(data ?? { types: [] });
  } catch (error) {
    console.error("Get task types proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 },
    );
  }
}
