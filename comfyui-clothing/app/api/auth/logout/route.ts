import { NextResponse } from "next/server"

const ACCESS_TOKEN_COOKIE = "access_token"

export async function POST() {
  const response = NextResponse.json({ status: "ok" })
  response.cookies.set({
    name: ACCESS_TOKEN_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  return response
}
