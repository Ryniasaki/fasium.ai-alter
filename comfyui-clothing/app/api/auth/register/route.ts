import { NextRequest, NextResponse } from "next/server";

import { verifyCaptchaChallenge } from "@/lib/captcha";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const tenantId = Number(body?.tenant_id ?? 1);
    const captchaToken = typeof body?.captchaToken === "string" ? body.captchaToken : "";
    const captchaCode = typeof body?.captchaCode === "string" ? body.captchaCode : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim().toLowerCase() : "";

    if (!username || !password || !phone) {
      return NextResponse.json({ detail: "Missing required fields" }, { status: 400 });
    }

    if (!EMAIL_PATTERN.test(username)) {
      return NextResponse.json({ detail: "Username must be a valid email address" }, { status: 400 });
    }

    if (!verifyCaptchaChallenge(captchaToken, captchaCode)) {
      return NextResponse.json({ detail: "Invalid or expired captcha" }, { status: 400 });
    }

    const payload = {
      username,
      email: username,
      phone,
      password,
      tenant_id: Number.isFinite(tenantId) ? tenantId : 1,
      invite_code: inviteCode || undefined,
    };

    const response = await fetch(`${TENANT_API_BASE}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Register proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
