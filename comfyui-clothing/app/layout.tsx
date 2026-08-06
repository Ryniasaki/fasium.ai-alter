import type React from "react"
import "@/styles/globals.css"
import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import { ThemeProvider } from "@/components/theme-provider"
import { Navigation } from "@/components/navigation"
import { MainWrapper } from "@/components/main-wrapper"
import { AuthProvider } from "@/contexts/auth-context"
import { I18nProvider } from "@/contexts/i18n-context"
import { LocaleSync } from "@/components/locale-sync"
import { locales, defaultLocale } from "@/lib/i18n/locale-config"
import { COOKIE_MAX_AGE, LOCALE_PREFERENCE_KEY, isLocale } from "@/lib/i18n/locale-utils"
import { UsageDurationTracker } from "@/components/usage-duration-tracker"

export const metadata: Metadata = {
  title: "Fasium - AI-Powered Fashion Design Studio",
  description:
    "Transform fashion design with AI. Extract patterns, apply designs, virtual try-on, and generate CAD files with cutting-edge AI technology.",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = cookies()
  const headerStore = headers()
  const storedLocale = cookieStore.get(LOCALE_PREFERENCE_KEY)?.value
  const forwardedHost = headerStore.get("x-forwarded-host")
  const host = (forwardedHost || headerStore.get("host") || "").split(",")[0]?.trim().toLowerCase()
  const isFasiumDomain = host === "fasium.ai" || host === "www.fasium.ai"
  const initialLocale = isLocale(storedLocale) ? storedLocale : defaultLocale

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body className="font-sans">
        <LocaleSync
          localeKey={LOCALE_PREFERENCE_KEY}
          validLocales={locales}
          cookieMaxAge={COOKIE_MAX_AGE}
        />
        <I18nProvider initialLocale={initialLocale} disableSystemLocaleDetection={isFasiumDomain}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            <AuthProvider>
              <UsageDurationTracker />
              <Navigation />
              <MainWrapper>{children}</MainWrapper>
            </AuthProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
