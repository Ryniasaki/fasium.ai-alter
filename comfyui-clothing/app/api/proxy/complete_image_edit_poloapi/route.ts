import { NextRequest, NextResponse } from "next/server";
import { requireAuthHeader } from "../utils";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

export async function POST(request: NextRequest) {
  try {
    const authHeader = requireAuthHeader(request);
    if (authHeader instanceof NextResponse) return authHeader;

    const formData = await request.formData();

    const response = await fetch(
      `${TENANT_API_BASE}/proxy/complete_image_edit_poloapi`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Complete image edit poloapi proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
