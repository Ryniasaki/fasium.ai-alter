"use client"

import { useEffect } from "react"
import type { Locale } from "@/lib/i18n/translations"

type LocaleSyncProps = {
  localeKey: string
  validLocales: readonly Locale[]
  cookieMaxAge: number
}

export function LocaleSync({ localeKey, validLocales, cookieMaxAge }: LocaleSyncProps) {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(localeKey)
      if (!stored || !validLocales.includes(stored as Locale)) {
        return
      }

      const pairs = document.cookie.split("; ")
      const match = pairs.find((pair) => pair.startsWith(`${localeKey}=`))
      if (match && match.split("=")[1] === stored) {
        return
      }

      document.cookie = `${localeKey}=${encodeURIComponent(stored)}; path=/; max-age=${cookieMaxAge}; SameSite=Lax`
    } catch (error) {
      console.warn("Locale sync failed", error)
    }
  }, [cookieMaxAge, localeKey, validLocales])

  return null
}
