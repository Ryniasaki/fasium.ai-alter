"use client"

import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2, Lock, Moon, RefreshCw, Sun, User, UserPlus, X, Phone } from "lucide-react"
import { useTheme } from "next-themes"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { ApiRequestError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AuthMode = "login" | "register"

export function AuthSurface() {
  const router = useRouter()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { messages } = useI18n()
  const { user, isAuthenticated, login, register, isLoading } = useAuth()
  const authPageCopy = messages.authPages
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<AuthMode>("login")
  const [isEnteringWorkspace, setIsEnteringWorkspace] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setIsEnteringWorkspace(false)
      return
    }

    setIsEnteringWorkspace(true)
    const timer = window.setTimeout(() => {
      router.replace("/board")
    }, 900)

    return () => window.clearTimeout(timer)
  }, [isAuthenticated, router])

  const isDark = mounted && (resolvedTheme ?? theme) === "dark"
  const surfaceStyle = {
    backgroundColor: isDark ? "rgba(9, 9, 11, 0.97)" : "rgba(255, 255, 255, 0.98)",
    color: isDark ? "#ffffff" : "#09090b",
    boxShadow: isDark ? "0 30px 120px -45px rgba(0,0,0,0.55)" : "0 30px 120px -45px rgba(0,0,0,0.16)",
  } as const

  const handleToggleTheme = () => {
    if (!mounted) return
    setTheme((resolvedTheme ?? theme) === "dark" ? "light" : "dark")
  }

  if (isAuthenticated || isEnteringWorkspace) {
    return (
      <div className="relative w-full max-w-[420px]">
        <div
          className="absolute inset-0 -z-10 rounded-[2rem] backdrop-blur-xl ring-1"
          style={{
            backgroundColor: isDark ? "rgba(9, 9, 11, 0.92)" : "rgba(255, 255, 255, 0.96)",
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)",
            boxShadow: isDark ? "0 24px 80px -36px rgba(0,0,0,0.65)" : "0 24px 80px -36px rgba(15,23,42,0.18)",
          }}
        />
        <div
          className="flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-[2rem] px-6 py-10 text-center"
          style={{
            backgroundColor: isDark ? "rgba(9, 9, 11, 0.97)" : "rgba(255, 255, 255, 0.98)",
            color: isDark ? "#ffffff" : "#09090b",
          }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10" style={{ color: isDark ? "#60a5fa" : "#2563eb" }}>
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <p className="text-2xl font-bold tracking-wide">{authPageCopy.enteringWorkspace}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full max-w-[560px]">
      <div
        className="absolute inset-0 -z-10 rounded-[2rem] backdrop-blur-xl ring-1"
        style={{
          backgroundColor: isDark ? "rgba(9, 9, 11, 0.92)" : "rgba(255, 255, 255, 0.96)",
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)",
          boxShadow: isDark ? "0 24px 80px -36px rgba(0,0,0,0.65)" : "0 24px 80px -36px rgba(15,23,42,0.18)",
        }}
      />

      <Card className="relative overflow-hidden rounded-[2rem] border-0 shadow-none" style={surfaceStyle}>
        <CardHeader className="px-6 pb-4 pt-6 sm:px-10 sm:pt-10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className={isDark ? "text-[11px] font-bold uppercase tracking-[0.35em] text-zinc-400" : "text-[11px] font-bold uppercase tracking-[0.35em] text-zinc-500"}>
                {authPageCopy.brandTagline}
              </div>
              <CardTitle className="text-3xl font-black tracking-tight sm:text-4xl" style={{ color: isDark ? "#fff" : "#09090b" }}>
                {mode === "login" ? authPageCopy.loginTitle : authPageCopy.registerTitle}
              </CardTitle>
              <p className="max-w-xl text-base leading-7" style={{ color: isDark ? "#a1a1aa" : "#6b7280" }}>
                {mode === "login"
                  ? authPageCopy.loginDescription
                  : authPageCopy.registerDescription}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleToggleTheme}
                className="h-10 w-10 rounded-full hover:bg-zinc-100"
                style={{ color: isDark ? "#a1a1aa" : "#6b7280" }}
                title={messages.common.a11y.toggleTheme}
                aria-label={messages.common.a11y.toggleTheme}
              >
                {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => (isAuthenticated ? router.push("/board") : setMode("login"))}
                className="h-10 w-10 rounded-full hover:bg-zinc-100"
                style={{ color: isDark ? "#fff" : "#09090b" }}
                title={messages.common.a11y.close}
                aria-label={messages.common.a11y.close}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-8 sm:px-10 sm:pb-10">
          {mode === "login" ? (
            <LoginForm
              isDark={isDark}
              isLoading={isLoading}
              onSubmit={async (username, password) => {
                return login({ username, password })
              }}
            />
          ) : (
            <RegisterForm
              isDark={isDark}
              isLoading={isLoading}
              onSuccess={() => setMode("login")}
              onSwitchToLogin={() => setMode("login")}
              registerAction={register}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LoginForm({
  isDark,
  isLoading,
  onSubmit,
}: {
  isDark: boolean
  isLoading: boolean
  onSubmit: (username: string, password: string) => Promise<boolean>
}) {
  const router = useRouter()
  const { messages } = useI18n()
  const copy = messages.authModals.login
  const a11y = messages.common.a11y
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError(copy.errors.missingCredentials)
      return
    }

    setError("")
    try {
      const success = await onSubmit(username, password)
      if (!success) {
        setError(copy.errors.invalidCredentials)
      }
    } catch {
      setError(copy.errors.generic)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="login-username" className="text-lg font-bold" style={{ color: "inherit" }}>
            {copy.usernameLabel}
          </Label>
          <div className="relative">
            <User className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: isLoading ? "#9ca3af" : "#6b7280" }} />
            <Input
              id="login-username"
              type="text"
              placeholder={copy.usernamePlaceholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-16 rounded-[1.5rem] py-6 pl-16 pr-6 text-lg shadow-none"
              style={{
                backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
                color: isDark ? "#fff" : "#09090b",
              }}
              disabled={isLoading}
              autoComplete="username"
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label htmlFor="login-password" className="text-lg font-bold" style={{ color: "inherit" }}>
            {copy.passwordLabel}
          </Label>
          <div className="relative">
            <Lock className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#6b7280" }} />
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              placeholder={copy.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-16 rounded-[1.5rem] py-6 pl-16 pr-16 text-lg shadow-none"
              style={{
                backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
                color: isDark ? "#fff" : "#09090b",
              }}
              disabled={isLoading}
              autoComplete="current-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full hover:bg-transparent"
              style={{ color: isDark ? "#a1a1aa" : "#6b7280" }}
              onClick={() => setShowPassword(!showPassword)}
              disabled={isLoading}
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              <span className="sr-only">{showPassword ? a11y.hidePassword : a11y.showPassword}</span>
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        ) : null}

        <Button type="submit" className="h-16 w-full rounded-full text-xl font-bold" disabled={isLoading}>
          {isLoading ? copy.submitting : copy.submit}
        </Button>
      </form>

      <div className="mt-8 text-center">
        <p className="text-base" style={{ color: isDark ? "#a1a1aa" : "#6b7280" }}>
          {copy.noAccount}
        </p>
        <Button
          variant="link"
          className="mt-2 h-auto p-0 text-base font-bold text-blue-600"
          onClick={() => router.push("/register")}
          disabled={isLoading}
        >
          {copy.registerCta}
        </Button>
      </div>
    </div>
  )
}

function RegisterForm({
  isDark,
  isLoading,
  onSuccess,
  onSwitchToLogin,
  registerAction,
}: {
  isDark: boolean
  isLoading: boolean
  onSuccess: () => void
  onSwitchToLogin: () => void
  registerAction: (payload: {
    username: string
    email: string
    phone: string
    password: string
    tenant_id: number
    captchaToken: string
    captchaCode: string
  }) => Promise<boolean>
}) {
  const { messages } = useI18n()
  const copy = messages.authModals.register
  const successCopy = messages.authModals.registrationSuccess
  const a11y = messages.common.a11y
  const [username, setUsername] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [captchaCode, setCaptchaCode] = useState("")
  const [captchaToken, setCaptchaToken] = useState("")
  const [captchaImage, setCaptchaImage] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false)
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const loadCaptcha = async () => {
    try {
      setIsCaptchaLoading(true)
      const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const response = await fetch(`/api/auth/captcha?ts=${cacheBuster}`, {
        method: "GET",
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("captcha-load-failed")
      }
      const payload = (await response.json()) as { token: string; image: string }
      setCaptchaToken(payload.token)
      setCaptchaImage(payload.image)
      setCaptchaCode("")
      setError("")
    } catch {
      setCaptchaToken("")
      setCaptchaImage("")
      setError(copy.errors.captchaLoadFailed)
    } finally {
      setIsCaptchaLoading(false)
    }
  }

  useEffect(() => {
    void loadCaptcha()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const normalizedUsername = username.trim().toLowerCase()

    if (!normalizedUsername || !phone.trim() || !password.trim() || !confirmPassword.trim() || !captchaCode.trim()) {
      setError(copy.errors.missingFields)
      return
    }

    if (!emailPattern.test(normalizedUsername)) {
      setError(copy.errors.invalidEmail)
      return
    }

    if (password !== confirmPassword) {
      setError(copy.errors.passwordMismatch)
      return
    }

    if (password.length < 6) {
      setError(copy.errors.passwordLength)
      return
    }

    if (!captchaToken) {
      setError(copy.errors.captchaLoadFailed)
      return
    }

    setError("")

    try {
      const success = await registerAction({
        username: normalizedUsername,
        email: normalizedUsername,
        phone: phone.trim(),
        password,
        tenant_id: 1,
        captchaToken,
        captchaCode,
      })
      if (success) {
        setSuccess(true)
        setTimeout(() => {
          onSuccess()
        }, 1800)
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.message.includes("captcha")) {
          setError(copy.errors.invalidCaptcha)
          void loadCaptcha()
          return
        }
        if (err.message.includes("valid email")) {
          setError(copy.errors.invalidEmail)
          return
        }
        if (err.message.includes("already registered")) {
          setError(copy.errors.usernameExists)
          void loadCaptcha()
          return
        }
      }
      setError(copy.errors.generic)
      void loadCaptcha()
    }
  }

  if (success) {
    return (
    <div
      className="mx-auto max-w-md rounded-[1.75rem] border px-6 py-10 text-center sm:px-10"
      style={{
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
        backgroundColor: isDark ? "rgba(24,24,27,0.46)" : "rgba(248,250,252,0.96)",
      }}
    >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10" style={{ color: isDark ? "#60a5fa" : "#2563eb" }}>
          <UserPlus className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-2xl font-bold" style={{ color: isDark ? "#fff" : "#09090b" }}>{successCopy.title}</h3>
        <p className="mt-2 text-sm leading-6" style={{ color: isDark ? "#a1a1aa" : "#6b7280" }}>{successCopy.message}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
              <div className="space-y-3">
                <Label htmlFor="reg-username" className="text-lg font-bold" style={{ color: "inherit" }}>
                  {copy.usernameLabel}
        </Label>
        <div className="relative">
          <User className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#6b7280" }} />
          <Input
            id="reg-username"
            type="email"
            placeholder={copy.usernamePlaceholder}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-16 rounded-[1.5rem] py-6 pl-16 pr-6 text-lg shadow-none"
            style={{
              backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
              color: isDark ? "#fff" : "#09090b",
            }}
            disabled={isLoading || isCaptchaLoading}
            autoComplete="email"
          />
                </div>
              </div>

            <div className="space-y-3">
              <Label htmlFor="reg-phone" className="text-lg font-bold" style={{ color: "inherit" }}>
                {copy.phoneLabel}
              </Label>
              <div className="relative">
                <Phone className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#6b7280" }} />
                <Input
                  id="reg-phone"
                  type="tel"
                  placeholder={copy.phonePlaceholder}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-16 rounded-[1.5rem] py-6 pl-16 pr-6 text-lg shadow-none"
                  style={{
                    backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
                    borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
                    color: isDark ? "#fff" : "#09090b",
                  }}
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="reg-password" className="text-lg font-bold" style={{ color: "inherit" }}>
                {copy.passwordLabel}
        </Label>
        <div className="relative">
          <Lock className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#6b7280" }} />
          <Input
            id="reg-password"
            type={showPassword ? "text" : "password"}
            placeholder={copy.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-16 rounded-[1.5rem] py-6 pl-16 pr-16 text-lg shadow-none"
            style={{
              backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
              color: isDark ? "#fff" : "#09090b",
            }}
            disabled={isLoading || isCaptchaLoading}
            autoComplete="new-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full hover:bg-transparent"
            style={{ color: "#6b7280" }}
            onClick={() => setShowPassword(!showPassword)}
            disabled={isLoading || isCaptchaLoading}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            <span className="sr-only">{showPassword ? a11y.hidePassword : a11y.showPassword}</span>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Label htmlFor="reg-confirm-password" className="text-lg font-bold" style={{ color: "inherit" }}>
          {copy.confirmPasswordLabel}
        </Label>
        <div className="relative">
          <Lock className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#6b7280" }} />
          <Input
            id="reg-confirm-password"
            type={showConfirmPassword ? "text" : "password"}
            placeholder={copy.confirmPasswordPlaceholder}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-16 rounded-[1.5rem] py-6 pl-16 pr-16 text-lg shadow-none"
            style={{
              backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
              color: isDark ? "#fff" : "#09090b",
            }}
            disabled={isLoading || isCaptchaLoading}
            autoComplete="new-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full hover:bg-transparent"
            style={{ color: "#6b7280" }}
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            disabled={isLoading || isCaptchaLoading}
          >
            {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            <span className="sr-only">{showConfirmPassword ? a11y.hidePassword : a11y.showPassword}</span>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="reg-captcha" className="text-lg font-bold" style={{ color: "inherit" }}>
            {copy.captchaLabel}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            style={{ color: "#6b7280" }}
            onClick={() => void loadCaptcha()}
            disabled={isLoading || isCaptchaLoading}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isCaptchaLoading ? "animate-spin" : ""}`} />
            {copy.refreshCaptcha}
          </Button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex h-14 w-full items-center justify-center overflow-hidden rounded-[1.25rem] border sm:w-36" style={{
            backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
          }}>
            {captchaImage ? (
              <img src={captchaImage} alt={copy.captchaImageAlt} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs" style={{ color: "#6b7280" }}>{copy.captchaLoading}</span>
            )}
          </div>
          <Input
            id="reg-captcha"
            type="text"
            placeholder={copy.captchaPlaceholder}
            value={captchaCode}
            onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
            className="h-14 flex-1 rounded-[1.25rem] px-6 text-[18px] uppercase shadow-none"
            style={{
              backgroundColor: isDark ? "rgba(24,24,27,0.7)" : "#eef4ff",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)",
              color: isDark ? "#fff" : "#09090b",
            }}
            disabled={isLoading || isCaptchaLoading}
            autoComplete="off"
            inputMode="text"
            maxLength={4}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : null}

      <Button type="submit" className="h-16 w-full rounded-full text-lg font-bold" disabled={isLoading || isCaptchaLoading}>
        {isLoading ? copy.submitting : copy.submit}
      </Button>

      <div className="text-center">
        <p className="text-base" style={{ color: "#6b7280" }}>{copy.alreadyHaveAccount}</p>
        <Button variant="link" className="mt-2 h-auto p-0 text-xl font-bold text-blue-600" onClick={onSwitchToLogin} disabled={isLoading}>
          {copy.loginCta}
        </Button>
      </div>
    </div>
  )
}
