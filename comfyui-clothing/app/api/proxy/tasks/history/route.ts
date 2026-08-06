import { NextRequest, NextResponse } from "next/server";
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
} from "../../utils";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const forwardedParams = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      if (value) {
        forwardedParams.set(key, value);
      }
    }

    if (!forwardedParams.has("page")) {
      forwardedParams.set("page", "1");
    }

    const queryString = forwardedParams.toString();
    const targetUrl = `${TENANT_API_BASE}/proxy/tasks/history${
      queryString ? `?${queryString}` : ""
    }`;

    // 代理获取任务历史请求到tenant service
    const response = await fetchTenantWithTimeout(targetUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    }, TENANT_REQUEST_TIMEOUT_MS);

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Get task history proxy error:", error);
    return NextResponse.json([]);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 }
      );
    }

    const rawBody = await request.text();
    let parsedBody: unknown = null;

    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch (error) {
      console.warn("Failed to parse DELETE /tasks/history body:", error);
      parsedBody = null;
    }

    const targetUrl = `${TENANT_API_BASE}/proxy/tasks/history`;

    const response = await fetchTenantWithTimeout(targetUrl, {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: parsedBody ? JSON.stringify(parsedBody) : rawBody || undefined,
    }, TENANT_REQUEST_TIMEOUT_MS);

    const responseText = await response.text();
    let data: unknown = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        console.warn("Failed to parse DELETE /proxy/tasks/history response:", error);
      }
    }

    if (!response.ok) {
      return NextResponse.json(data ?? { detail: responseText || "Request failed" }, { status: response.status });
    }

    return NextResponse.json(data ?? {});
  } catch (error) {
    console.error("Delete task history proxy error:", error);
    return NextResponse.json(
      { detail: "Task history request failed" },
      { status: 503 }
    );
  }
}
