import { NextRequest, NextResponse } from "next/server"

import { requireAuthHeader, TENANT_API_BASE } from "../../proxy/utils"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeaderOrResponse = requireAuthHeader(request)
  if (authHeaderOrResponse instanceof NextResponse) {
    return authHeaderOrResponse
  }
  const authHeader = authHeaderOrResponse

  const encoder = new TextEncoder()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let lastCredit: number | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      const writeComment = (text: string) => {
        controller.enqueue(encoder.encode(`: ${text}\n\n`))
      }

      const pollCredit = async () => {
        try {
          const response = await fetch(`${TENANT_API_BASE}/auth/me`, {
            method: "GET",
            headers: { Authorization: authHeader },
            cache: "no-store",
          })
          if (!response.ok) {
            writeEvent("error", { status: response.status, detail: "auth_failed" })
            return
          }

          const data = (await response.json()) as { credit?: number }
          const nextCredit = typeof data.credit === "number" ? data.credit : 0
          if (lastCredit === null || nextCredit !== lastCredit) {
            lastCredit = nextCredit
            writeEvent("credit_update", { credit: nextCredit })
          }
        } catch {
          writeComment("poll_error")
        }
      }

      writeEvent("ready", { ok: true })
      void pollCredit()
      pollTimer = setInterval(() => {
        void pollCredit()
      }, 10000)
      heartbeatTimer = setInterval(() => {
        writeComment("keepalive")
      }, 15000)

      request.signal.addEventListener("abort", () => {
        if (pollTimer) clearInterval(pollTimer)
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try {
          controller.close()
        } catch {
          // ignore double-close
        }
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

