"use client"

import { useI18n } from "@/contexts/i18n-context"
import { locales } from "@/lib/i18n/locale-config"
import { cn } from "@/lib/utils"

type LanguageSwitcherProps = {
  className?: string
  showLabel?: boolean
}

export function LanguageSwitcher({ className, showLabel = false }: LanguageSwitcherProps) {
  const { locale, setLocale, messages } = useI18n()
  const { label, options } = messages.common.languageSwitcher
  const ariaLabel = messages.common.a11y.changeLanguage

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showLabel && <span className="text-sm text-muted-foreground">{label}</span>}
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex rounded-full border border-border/60 bg-zinc-50/90 p-0.5 text-xs font-medium shadow-sm dark:bg-background/80"
      >
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={locale === code}
            className={cn(
              "px-3 py-1 rounded-full transition-colors",
              locale === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {options[code]}
          </button>
        ))}
      </div>
    </div>
  )
}
