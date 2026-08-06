import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 }
      );
    }

    // 代理完成任务请求到tenant service
    const response = await fetch(
      `${TENANT_API_BASE}/proxy/tasks/${params.taskId}/complete`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Complete task proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
