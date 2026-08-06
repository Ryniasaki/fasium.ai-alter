"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Moon, Sun, Languages } from "lucide-react"
import { useTheme } from "next-themes"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { RegisterPanel } from "@/components/register-panel"

export default function RegisterPage() {
  const router = useRouter()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { locale, setLocale, messages } = useI18n()
  const { isAuthenticated, isLoading } = useAuth()
  const authPageCopy = messages.authPages
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/board")
    }
  }, [isAuthenticated, router])

  const isDark = mounted && (resolvedTheme ?? theme) === "dark"

  const handleToggleTheme = () => {
    if (!mounted) return
    setTheme((resolvedTheme ?? theme) === "dark" ? "light" : "dark")
  }

  if (isLoading || isAuthenticated) {
    return (
      <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background text-foreground transition-colors duration-700">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.07),transparent_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.06),transparent_30%)]" />
        <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-8 sm:px-6 lg:px-10">
          <div className="flex min-h-[260px] w-full max-w-md flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-border bg-background/90 px-6 py-10 text-center text-foreground shadow-2xl backdrop-blur-lg">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <p className="text-2xl font-bold tracking-wide text-foreground/80">{authPageCopy.loadingRegister}</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background text-foreground transition-colors duration-700">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.07),transparent_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.06),transparent_30%)]" />

      <header className="relative z-20 flex items-center justify-between px-6 py-5 sm:px-8 lg:px-12 lg:py-8">
        <div className="flex flex-col">
          <span className="text-2xl font-black uppercase leading-none tracking-tighter sm:text-3xl">
            Fasium<span className="text-blue-500">.</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="flex items-center gap-2 rounded-full border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600 transition-colors hover:bg-white dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-900 sm:px-4"
            title={messages.common.a11y.changeLanguage}
            aria-label={messages.common.a11y.changeLanguage}
          >
            <Languages size={16} />
            <span>{locale === "zh" ? messages.common.languageSwitcher.options.en : messages.common.languageSwitcher.options.zh}</span>
          </button>
          <button
            onClick={handleToggleTheme}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200/80 bg-zinc-50/90 text-zinc-600 transition-colors hover:bg-white dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-900"
            title={messages.common.a11y.toggleTheme}
            aria-label={messages.common.a11y.toggleTheme}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-8 sm:px-6 lg:px-10">
        <RegisterPanel />
      </main>

      <footer className="relative z-10 px-6 pb-6 text-center text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
        <div>{authPageCopy.copyright}</div>
        <div>{authPageCopy.icp}</div>
      </footer>
    </div>
  )
}
