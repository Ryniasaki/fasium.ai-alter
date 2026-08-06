"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { defaultLocale } from "@/lib/i18n/locale-config"
import type { Locale } from "@/lib/i18n/locale-config"
import { translations } from "@/lib/i18n/translations"
import type { Messages } from "@/lib/i18n/translations"
import { COOKIE_MAX_AGE, LOCALE_PREFERENCE_KEY, isLocale } from "@/lib/i18n/locale-utils"

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  messages: Messages
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

type I18nProviderProps = {
  children: ReactNode
  initialLocale?: Locale
  disableSystemLocaleDetection?: boolean
}

export function I18nProvider({
  children,
  initialLocale = defaultLocale,
  disableSystemLocaleDetection = false,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    if (typeof window === "undefined") return

    const resolveSystemLocale = () => {
      const rawLanguages = Array.isArray(window.navigator?.languages) ? window.navigator.languages : []
      const candidates = [...rawLanguages, window.navigator?.language]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase().split("-")[0])
      for (const candidate of candidates) {
        if (isLocale(candidate)) return candidate
      }
      return null
    }

    try {
      const stored = window.localStorage.getItem(LOCALE_PREFERENCE_KEY)
      if (stored && isLocale(stored) && stored !== initialLocale) {
        setLocaleState(stored)
        return
      }

      if (!disableSystemLocaleDetection) {
        const systemLocale = resolveSystemLocale()
        if (systemLocale && systemLocale !== initialLocale) {
          setLocaleState(systemLocale)
        }
      }
    } catch (error) {
      console.warn("Failed to sync locale from storage", error)
    }
  }, [disableSystemLocaleDetection, initialLocale])

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LOCALE_PREFERENCE_KEY, locale)
      } catch (error) {
        console.warn("Failed to persist locale to storage", error)
      }

      const cookieValue = `${LOCALE_PREFERENCE_KEY}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
      document.cookie = cookieValue
      document.documentElement.lang = locale
    }
  }, [locale])

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale)
  }

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      messages: translations[locale],
    }),
    [locale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider")
  }
  return context
}
