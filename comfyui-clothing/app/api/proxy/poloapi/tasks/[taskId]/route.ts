import { NextRequest, NextResponse } from "next/server";
import { requireAuthHeader, TENANT_API_BASE } from "../../../utils";

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const authHeader = requireAuthHeader(request);
    if (authHeader instanceof NextResponse) return authHeader;

    const response = await fetch(
      `${TENANT_API_BASE}/proxy/poloapi/tasks/${params.taskId}`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Get poloapi task status proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
