"use client"

import type { FormEvent, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { Locale, locales } from "@/lib/i18n/locale-config"

const FALLBACK_SETTINGS = {
  navLabel: "Settings",
  title: "Settings",
  description: "Account and device preferences.",
  appearanceLabel: "Appearance",
  appearanceDescription: "Choose a color scheme for the workspace.",
  lightModeLabel: "Light mode",
  darkModeLabel: "Dark mode",
  languageLabel: "Language",
  languageDescription: "Pick the locale that best matches your working language.",
  languageOptions: {
    en: "English",
    zh: "中文",
  },
  securityLabel: "Security",
  changePasswordLabel: "Change password",
  changePasswordDescription: "Update your account security credentials.",
  cancelLabel: "Cancel",
  saveChangesLabel: "Save changes",
  currentPasswordLabel: "Current password",
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm new password",
  passwordPlaceholder: "••••••••",
  updatePasswordSuccessTitle: "Password updated",
  updatePasswordSuccessDescription: "Please log in again with your new password.",
  errors: {
    missingFields: "Please fill in all password fields.",
    passwordMismatch: "Passwords do not match.",
    passwordLength: "Password must be at least 6 characters.",
    requestFailed: "Unable to update password. Please try again.",
  },
  toast: {
    title: "Language updated",
    description: "The interface now respects your selected language.",
  },
  footer: "© 2025 System Dashboard",
} as const

type SettingsCopy = typeof FALLBACK_SETTINGS

type SettingsGroupProps = {
  label?: string
  children: ReactNode
}

const SettingsGroup = ({ label, children }: SettingsGroupProps) => (
  <div className="mb-8">
    {label && (
      <h2 className="px-4 mb-2 text-[13px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </h2>
    )}
    <div className="rounded-xl overflow-hidden border border-border bg-card shadow-sm">
      <div className="divide-y divide-border">{children}</div>
    </div>
  </div>
)

type SettingsRowProps = {
  label: string
  description?: string
  icon?: ReactNode
  action: ReactNode
}

const SettingsRow = ({ label, description, icon, action }: SettingsRowProps) => (
  <div className="flex items-center justify-between p-4 min-h-[64px]">
    <div className="flex items-center gap-4">
      {icon && (
        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </div>
      )}
      <div>
        <p className="text-[16px] font-medium leading-none text-foreground">{label}</p>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-1">{description}</p>
        )}
      </div>
    </div>
    <div>{action}</div>
  </div>
)

type SecurityFormProps = {
  settings: SettingsCopy
  token: string | null
  onLogout: () => void
  onRedirect: () => void
}

const SecurityForm = ({ settings, token, onLogout, onRedirect }: SecurityFormProps) => {
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const inputClass =
    "w-full px-0 py-2 bg-transparent border-b border-border focus:border-foreground/60 focus:outline-none transition-colors text-foreground placeholder:text-muted-foreground"

  const resetForm = () => {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: settings.errors.missingFields, type: "error" })
      return
    }
    if (newPassword.length < 6) {
      setMessage({ text: settings.errors.passwordLength, type: "error" })
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage({ text: settings.errors.passwordMismatch, type: "error" })
      return
    }
    if (!token) {
      setMessage({ text: settings.errors.requestFailed, type: "error" })
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const detail = (data as { detail?: string } | null)?.detail
        setMessage({ text: detail || settings.errors.requestFailed, type: "error" })
        return
      }
      toast({
        title: settings.updatePasswordSuccessTitle,
        description: settings.updatePasswordSuccessDescription,
      })
      setMessage({ text: settings.updatePasswordSuccessTitle, type: "success" })
      resetForm()
      onLogout()
      onRedirect()
    } catch (error) {
      console.error("Change password error:", error)
      setMessage({ text: settings.errors.requestFailed, type: "error" })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-muted text-foreground">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 00-2 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-[16px] font-medium leading-none text-foreground">
              {settings.changePasswordLabel}
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">{settings.changePasswordDescription}</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )
  }

  return (
    <div className="p-4 space-y-6 animate-in slide-in-from-top-4 duration-300">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{settings.changePasswordLabel}</h3>
        <button
          type="button"
          onClick={() => {
            setIsEditing(false)
            resetForm()
            setMessage(null)
          }}
          className="text-[13px] text-primary font-medium hover:underline"
        >
          {settings.cancelLabel}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {message && (
          <div
            className={`text-sm font-medium ${
              message.type === "success" ? "text-primary" : "text-destructive"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-tight">
              {settings.currentPasswordLabel}
            </label>
            <input
              type="password"
              required
              autoFocus
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
              placeholder={settings.passwordPlaceholder}
              autoComplete="current-password"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-tight">
                {settings.newPasswordLabel}
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={inputClass}
                placeholder={settings.passwordPlaceholder}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-tight">
                {settings.confirmPasswordLabel}
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={inputClass}
                placeholder={settings.passwordPlaceholder}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        <div className="flex pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto px-10 py-2.5 bg-foreground text-background text-[14px] font-semibold rounded-full hover:opacity-80 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {settings.saveChangesLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function SettingsPage() {
  const { locale, setLocale, messages } = useI18n()
  const { token, logout } = useAuth()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const router = useRouter()
  const settings = (messages.settings ?? FALLBACK_SETTINGS) as SettingsCopy
  const { toast } = useToast()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLanguageChange = (nextLocale: Locale) => {
    if (nextLocale === locale) {
      return
    }
    setLocale(nextLocale)
    toast({
      title: settings.toast.title,
      description: settings.toast.description,
    })
  }

  const isDarkMode = mounted ? resolvedTheme === "dark" : theme === "dark"

  const toggleTheme = () => {
    const nextTheme = isDarkMode ? "light" : "dark"
    setTheme(nextTheme)
  }

  const languageLabel = useMemo(() => settings.languageOptions[locale], [locale, settings.languageOptions])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[720px] mx-auto px-6 py-16 animate-fade-in">
        <div className="mb-10 px-4">
          <h1 className="text-3xl font-bold tracking-tight mb-1">{settings.title}</h1>
          <p className="text-[15px] text-muted-foreground">{settings.description}</p>
        </div>

        <div className="space-y-2">
          <SettingsGroup label={settings.appearanceLabel}>
            <SettingsRow
              label={isDarkMode ? settings.darkModeLabel : settings.lightModeLabel}
              description={settings.appearanceDescription}
              icon={
                isDarkMode ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )
              }
              action={
                <button
                  type="button"
                  onClick={toggleTheme}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    isDarkMode ? "bg-primary" : "bg-muted"
                  }`}
                  aria-label={settings.appearanceLabel}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                      isDarkMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              }
            />
          </SettingsGroup>

          <SettingsGroup label={settings.languageLabel}>
            <SettingsRow
              label={languageLabel}
              description={settings.languageDescription}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              }
              action={
                <div className="relative inline-flex items-center">
                  <select
                    value={locale}
                    onChange={(event) => handleLanguageChange(event.target.value as Locale)}
                    className="appearance-none rounded-full border border-border bg-muted/60 px-3 py-1.5 pr-8 text-[14px] font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {locales.map((option) => (
                      <option key={option} value={option}>
                        {settings.languageOptions[option]}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              }
            />
          </SettingsGroup>

          <SettingsGroup label={settings.securityLabel}>
            <SecurityForm
              settings={settings}
              token={token}
              onLogout={logout}
              onRedirect={() => router.push("/")}
            />
          </SettingsGroup>
        </div>

      </div>
    </div>
  )
}
