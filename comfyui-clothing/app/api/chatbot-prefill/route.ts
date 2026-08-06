import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { query } = await request.json()
    const value = typeof query === "string" ? query : ""
    const response = NextResponse.json({ ok: true })
    if (value) {
      response.cookies.set("chatbot_prefill", value, {
        path: "/",
        maxAge: 300, // 5 minutes
        sameSite: "lax",
      })
    }
    return response
  } catch (error) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
