"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { Sun, Moon, Languages } from "lucide-react"
import { useI18n } from "@/contexts/i18n-context"
import { AuthSurface } from "@/components/auth-surface"

export default function LandingPage() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { locale, setLocale, messages } = useI18n()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && (resolvedTheme ?? theme) === "dark"

  const handleToggleTheme = () => {
    if (!mounted) return
    setTheme((resolvedTheme ?? theme) === "dark" ? "light" : "dark")
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#f6f7fb] text-zinc-900 transition-colors duration-700 dark:bg-[#0b0c10] dark:text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.07),transparent_32%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.06),transparent_30%)]" />

      <header className="relative z-20 flex items-center justify-between px-6 py-5 sm:px-8 lg:px-12 lg:py-8">
        <div className="flex flex-col">
          <span className="text-2xl font-black tracking-tighter uppercase leading-none sm:text-3xl">
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
            <span>{locale === "zh" ? "EN" : "中文"}</span>
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
        <AuthSurface />
      </main>

      <footer className="relative z-10 px-6 pb-6 text-center text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
        <div>上海聚托信息科技有限公司©2026</div>
        <div>沪ICP备15056478号-5</div>
      </footer>
    </div>
  )
}
