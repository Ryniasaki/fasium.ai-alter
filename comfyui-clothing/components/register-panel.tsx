"use client"

import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Lock, RefreshCw, User, UserPlus, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { ApiRequestError } from "@/lib/api-client"

export function RegisterPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { register, isLoading } = useAuth()
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
  const inviteCode = searchParams.get("invite")?.trim().toLowerCase() || ""

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

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => {
      router.push("/")
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [router, success])

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
      const ok = await register({
        username: normalizedUsername,
        email: normalizedUsername,
        phone: phone.trim(),
        password,
        tenant_id: 1,
        captchaToken,
        captchaCode,
        inviteCode: inviteCode || undefined,
      })
      if (ok) {
        setSuccess(true)
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
        if (err.message.toLowerCase().includes("invite")) {
          setError(err.message)
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
      <div className="mx-auto max-w-md rounded-[1.75rem] border px-6 py-10 text-center sm:px-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-600">
          <UserPlus className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-2xl font-bold">{successCopy.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{successCopy.message}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => router.push("/")}>
            {copy.loginCta}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <Card className="border-border/40 bg-background/95 shadow-2xl backdrop-blur-lg">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-3xl font-bold">{copy.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </CardHeader>

        <CardContent className="space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {inviteCode ? (
              <div className="rounded-md border border-primary/20 bg-primary/10 p-3">
                <p className="text-sm text-foreground">
                  你正在通过邀请链接注册。注册成功后，你将获得 <span className="font-bold text-primary">1000 点数</span>；邀请者仅在前三次成功邀请内可获得同等奖励。
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="reg-username" className="text-sm font-medium">
                {copy.usernameLabel}
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reg-username"
                  type="email"
                  placeholder={copy.usernamePlaceholder}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10"
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-phone" className="text-sm font-medium">
                {copy.phoneLabel}
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reg-phone"
                  type="tel"
                  placeholder={copy.phonePlaceholder}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-10"
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-password" className="text-sm font-medium">
                {copy.passwordLabel}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={copy.passwordPlaceholder}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading || isCaptchaLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">{showPassword ? a11y.hidePassword : a11y.showPassword}</span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-confirm-password" className="text-sm font-medium">
                {copy.confirmPasswordLabel}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reg-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder={copy.confirmPasswordPlaceholder}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 pr-10"
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isLoading || isCaptchaLoading}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">{showConfirmPassword ? a11y.hidePassword : a11y.showPassword}</span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="reg-captcha" className="text-sm font-medium">
                  {copy.captchaLabel}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => void loadCaptcha()}
                  disabled={isLoading || isCaptchaLoading}
                >
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isCaptchaLoading ? "animate-spin" : ""}`} />
                  {copy.refreshCaptcha}
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-40 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                  {captchaImage ? (
                    <img src={captchaImage} alt={copy.captchaImageAlt} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">{copy.captchaLoading}</span>
                  )}
                </div>
                <Input
                  id="reg-captcha"
                  type="text"
                  placeholder={copy.captchaPlaceholder}
                  value={captchaCode}
                  onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                  className="uppercase"
                  disabled={isLoading || isCaptchaLoading}
                  autoComplete="off"
                  inputMode="text"
                  maxLength={4}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full rounded-full" disabled={isLoading || isCaptchaLoading}>
              {isLoading ? copy.submitting : copy.submit}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            <p>{copy.alreadyHaveAccount}</p>
            <Button variant="link" className="h-auto p-0 text-primary" onClick={() => router.push("/")} disabled={isLoading}>
              {copy.loginCta}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
