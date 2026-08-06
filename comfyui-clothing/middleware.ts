import { NextRequest, NextResponse } from "next/server"

const ACCESS_TOKEN_COOKIE = "access_token"
const IS_PRODUCTION = process.env.NODE_ENV === "production"

function shouldInjectAuthHeader(authHeader: string | null): boolean {
  if (!authHeader) {
    return true
  }
  return /Bearer\s+(null|undefined|__cookie__)\b/i.test(authHeader)
}

function isLocalHost(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1")
}

function getForwardedProto(request: NextRequest): string | null {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  if (!forwardedProto) return null
  return forwardedProto.split(",")[0]?.trim().toLowerCase() ?? null
}

function getForwardedHost(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim().toLowerCase()
    if (host) return host
  }

  return request.nextUrl.host.toLowerCase()
}

function shouldRedirectToHttps(request: NextRequest): boolean {
  if (!IS_PRODUCTION) return false

  const host = getForwardedHost(request)
  if (isLocalHost(host)) return false

  const forwardedProto = getForwardedProto(request)
  if (forwardedProto) {
    return forwardedProto === "http"
  }

  return request.nextUrl.protocol === "http:"
}

export function middleware(request: NextRequest) {
  if (shouldRedirectToHttps(request)) {
    const httpsUrl = request.nextUrl.clone()
    httpsUrl.host = getForwardedHost(request)
    httpsUrl.protocol = "https:"
    return NextResponse.redirect(httpsUrl, 301)
  }

  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  if (!token) {
    return NextResponse.next()
  }

  const authHeader = request.headers.get("authorization")
  if (!shouldInjectAuthHeader(authHeader)) {
    return NextResponse.next()
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("authorization", `Bearer ${token}`)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: "/:path*",
}
