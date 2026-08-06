import { NextResponse } from "next/server"

import { issueCaptchaChallenge } from "@/lib/captcha"

export const dynamic = "force-dynamic"

export async function GET() {
  const challenge = issueCaptchaChallenge()

  return NextResponse.json(
    {
      token: challenge.token,
      image: `data:image/svg+xml;base64,${Buffer.from(challenge.svg, "utf8").toString("base64")}`,
      expiresInMs: challenge.expiresInMs,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  )
}
