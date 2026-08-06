"use client"

import { useEffect, useRef } from "react"
import { useAuth } from "@/contexts/auth-context"

type UsageEventType = "start" | "heartbeat" | "end"

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

const HEARTBEAT_INTERVAL_MS = 30000
const MIN_REPORTABLE_DELTA_MS = 1000
const GLOBAL_PAGE_PATH = "/global"

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `usage-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function postUsage(payload: UsagePayload, preferBeacon = false) {
  const body = JSON.stringify(payload)

  if (preferBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" })
    navigator.sendBeacon("/api/analytics/usage", blob)
    return
  }

  void fetch("/api/analytics/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: preferBeacon,
  }).catch(() => {
    // Tracking should never break primary UX.
  })
}

export function UsageDurationTracker() {
  const { user, isAuthenticated, isLoading } = useAuth()

  const sessionIdRef = useRef<string>("")
  const sessionStartedAtRef = useRef<number>(0)
  const activeSinceRef = useRef<number | null>(null)
  const accumulatedMsRef = useRef<number>(0)
  const currentPathRef = useRef<string>(GLOBAL_PAGE_PATH)
  const endedRef = useRef<boolean>(false)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated || !user?.id) return
    if (typeof window === "undefined") return

    const now = Date.now()
    sessionIdRef.current = createSessionId()
    sessionStartedAtRef.current = now
    activeSinceRef.current = !document.hidden && document.hasFocus() ? now : null
    accumulatedMsRef.current = 0
    endedRef.current = false

    const flush = (eventType: UsageEventType, preferBeacon = false) => {
      const eventAt = Date.now()

      if (activeSinceRef.current !== null) {
        accumulatedMsRef.current += Math.max(0, eventAt - activeSinceRef.current)
        activeSinceRef.current = eventAt
      }

      const deltaMs = Math.floor(accumulatedMsRef.current)
      if (deltaMs < MIN_REPORTABLE_DELTA_MS && eventType === "heartbeat") return

      postUsage(
        {
          userId: user.id,
          username: user.username,
          sessionId: sessionIdRef.current,
          eventType,
          pagePath: currentPathRef.current,
          sessionStartedAt: new Date(sessionStartedAtRef.current).toISOString(),
          eventAt: new Date(eventAt).toISOString(),
          deltaMs,
        },
        preferBeacon,
      )
      accumulatedMsRef.current = 0
    }

    postUsage({
      userId: user.id,
      username: user.username,
      sessionId: sessionIdRef.current,
      eventType: "start",
      pagePath: currentPathRef.current,
      sessionStartedAt: new Date(sessionStartedAtRef.current).toISOString(),
      eventAt: new Date(now).toISOString(),
      deltaMs: 0,
    })

    const onVisibilityChange = () => {
      const timestamp = Date.now()
      if (document.hidden) {
        if (activeSinceRef.current !== null) {
          accumulatedMsRef.current += Math.max(0, timestamp - activeSinceRef.current)
          activeSinceRef.current = null
        }
        flush("heartbeat", true)
        return
      }
      if (activeSinceRef.current === null) {
        activeSinceRef.current = timestamp
      }
    }

    const onFocus = () => {
      if (activeSinceRef.current === null && !document.hidden) {
        activeSinceRef.current = Date.now()
      }
    }

    const onBlur = () => {
      if (activeSinceRef.current !== null) {
        const timestamp = Date.now()
        accumulatedMsRef.current += Math.max(0, timestamp - activeSinceRef.current)
        activeSinceRef.current = null
      }
      flush("heartbeat", true)
    }

    const onPageHide = () => {
      if (endedRef.current) return
      endedRef.current = true
      if (activeSinceRef.current !== null) {
        const timestamp = Date.now()
        accumulatedMsRef.current += Math.max(0, timestamp - activeSinceRef.current)
        activeSinceRef.current = null
      }
      flush("end", true)
    }

    const timer = window.setInterval(() => {
      flush("heartbeat")
    }, HEARTBEAT_INTERVAL_MS)

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    window.addEventListener("pagehide", onPageHide)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
      window.removeEventListener("pagehide", onPageHide)
      onPageHide()
    }
  }, [isAuthenticated, isLoading, user?.id, user?.username])

  return null
}
