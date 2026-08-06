import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL ||
  process.env.NEXT_PUBLIC_TENANT_API_URL ||
  "http://localhost:8081";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { detail: "Authorization header required" },
        { status: 401 },
      );
    }

    const payload = await request.json();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(
          `${TENANT_API_BASE}/proxy/llm/stripe_variations`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          return NextResponse.json(
            data ?? { detail: "Stripe variation suggestion failed" },
            { status: response.status },
          );
        }

        if (data) return NextResponse.json(data);
        return new NextResponse(text || "{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        lastError = error;
        // Retry on transient connection issues
        if (attempt < MAX_RETRIES) {
          console.warn(
            `LLM stripe variation proxy attempt ${attempt + 1} failed, retrying...`,
            error,
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
      }
    }

    throw lastError ?? new Error("Unknown stripe variation proxy error");
  } catch (error) {
    console.error("LLM stripe variation proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 },
    );
  }
}
