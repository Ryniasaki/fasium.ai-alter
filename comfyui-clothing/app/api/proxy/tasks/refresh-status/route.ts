import { NextRequest, NextResponse } from "next/server";
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
} from "../../utils";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 },
      );
    }

    const payload = await request.json().catch(() => null);

    if (payload === null || typeof payload !== "object") {
      return NextResponse.json(
        { detail: "Invalid request body" },
        { status: 400 },
      );
    }

    const response = await fetchTenantWithTimeout(
      `${TENANT_API_BASE}/proxy/tasks/refresh-status`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      TENANT_REQUEST_TIMEOUT_MS,
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { detail: "Refresh status request failed" },
        { status: response.status },
      );
    }

    if (data === null) {
      return NextResponse.json({ detail: "Empty response" });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Refresh task status proxy error:", error);
    return NextResponse.json({
      tasks: [],
      checked_ids: [],
      updated_count: 0,
      removed_ids: [],
    });
  }
}
