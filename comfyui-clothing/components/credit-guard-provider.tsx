"use client"

import { useEffect } from "react"
import { notifyCreditInsufficient } from "@/lib/credit-guard"

declare global {
  interface Window {
    __creditGuardInstalled?: boolean
    __creditGuardFetch?: typeof fetch
  }
}

export function CreditGuardProvider() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.__creditGuardInstalled) return

    const originalFetch = window.fetch.bind(window)
    window.__creditGuardFetch = originalFetch
    window.__creditGuardInstalled = true

    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      if (response.status === 402) {
        const clone = response.clone()
        try {
          const data = await clone.json()
          if (data && typeof data === "object" && "detail" in data) {
            const detail = (data as Record<string, unknown>).detail
            if (detail && typeof detail === "object") {
              notifyCreditInsufficient(detail as Record<string, unknown>)
            } else if (detail && typeof detail === "string") {
              notifyCreditInsufficient({ detail })
            } else {
              notifyCreditInsufficient()
            }
          } else {
            notifyCreditInsufficient()
          }
        } catch {
          try {
            const text = await clone.text()
            notifyCreditInsufficient(text ? { detail: text } : undefined)
          } catch {
            notifyCreditInsufficient()
          }
        }
      }
      return response
    }

    return () => {
      if (window.__creditGuardFetch) {
        window.fetch = window.__creditGuardFetch
      }
      window.__creditGuardInstalled = false
    }
  }, [])

  return null
}
