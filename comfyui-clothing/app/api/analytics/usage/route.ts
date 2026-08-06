import { mkdir, appendFile } from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import {
  TENANT_API_BASE,
  TENANT_REQUEST_TIMEOUT_MS,
  fetchTenantWithTimeout,
  requireAuthHeader,
} from "../../proxy/utils"

export const runtime = "nodejs"

type UsageEventType = "start" | "heartbeat" | "route_change" | "end"

type UsagePayload = {
  userId: number
  username: string
  sessionId: string
  eventType: UsageEventType
  pagePath: string
  sessionStartedAt: string
  eventAt: string
  deltaMs: number
}

const USAGE_EVENT_TYPES: UsageEventType[] = ["start", "heartbeat", "route_change", "end"]

function getUsageLogPath() {
  const configured = process.env.USAGE_ANALYTICS_LOG_PATH
  if (configured && configured.trim()) {
    return configured
  }
  return path.join(process.cwd(), "logs", "usage-analytics.ndjson")
}

function normalizePayload(input: unknown): UsagePayload | null {
  if (!input || typeof input !== "object") return null
  const payload = input as Partial<UsagePayload>
  if (typeof payload.userId !== "number" || !Number.isFinite(payload.userId) || payload.userId <= 0) return null
  if (!payload.username || typeof payload.username !== "string") return null
  if (!payload.sessionId || typeof payload.sessionId !== "string") return null
  if (!payload.pagePath || typeof payload.pagePath !== "string") return null
  if (!payload.eventType || !USAGE_EVENT_TYPES.includes(payload.eventType)) return null
  if (!payload.sessionStartedAt || typeof payload.sessionStartedAt !== "string") return null
  if (!payload.eventAt || typeof payload.eventAt !== "string") return null
  if (typeof payload.deltaMs !== "number" || !Number.isFinite(payload.deltaMs) || payload.deltaMs < 0) return null
  return {
    userId: Math.floor(payload.userId),
    username: payload.username,
    sessionId: payload.sessionId,
    eventType: payload.eventType,
    pagePath: payload.pagePath,
    sessionStartedAt: payload.sessionStartedAt,
    eventAt: payload.eventAt,
    deltaMs: Math.min(Math.floor(payload.deltaMs), 60 * 60 * 1000),
  }
}

async function persistLocalEvent(request: NextRequest, payload: UsagePayload) {
  const logPath = getUsageLogPath()
  const logDir = path.dirname(logPath)
  await mkdir(logDir, { recursive: true })

  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
  const line = JSON.stringify({
    ...payload,
    ip,
    userAgent: request.headers.get("user-agent") || null,
    serverReceivedAt: new Date().toISOString(),
  })
  await appendFile(logPath, `${line}\n`, "utf8")
}

async function forwardToTenant(payload: UsagePayload, authHeader: string) {
  const forwardPath = (process.env.TENANT_USAGE_ANALYTICS_PATH || "/analytics/usage").trim()
  const targetUrl = `${TENANT_API_BASE}${forwardPath.startsWith("/") ? forwardPath : `/${forwardPath}`}`
  return await fetchTenantWithTimeout(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  }, TENANT_REQUEST_TIMEOUT_MS)
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = requireAuthHeader(request)
    if (authHeader instanceof NextResponse) return authHeader

    const parsed = normalizePayload(await request.json().catch(() => null))
    if (!parsed) {
      return NextResponse.json({ detail: "Invalid usage payload" }, { status: 400 })
    }

    await persistLocalEvent(request, parsed)

    let forwardResponse: Response
    try {
      forwardResponse = await forwardToTenant(parsed, authHeader)
    } catch (error) {
      console.error("usage analytics tenant forward failed:", error)
      return NextResponse.json({ ok: true, persisted: "local-only" })
    }

    if (!forwardResponse.ok) {
      const text = await forwardResponse.text().catch(() => "")
      console.warn("usage analytics tenant forward returned non-ok:", forwardResponse.status, text)
      return NextResponse.json({ ok: true, persisted: "local-only" })
    }

    return NextResponse.json({ ok: true, persisted: "tenant+local" })
  } catch (error) {
    console.error("usage analytics error:", error)
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 })
  }
}
