"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Eye, EyeOff, User, Lock, UserPlus, RefreshCw, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import { ApiRequestError } from "@/lib/api-client"

interface RegisterModalProps {
  isOpen: boolean
  onClose: () => void
  onSwitchToLogin: () => void
}

export function RegisterModal({ isOpen, onClose, onSwitchToLogin }: RegisterModalProps) {
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
  const { register, isLoading } = useAuth()
  const { messages } = useI18n()
  const registerCopy = messages.authModals.register
  const successCopy = messages.authModals.registrationSuccess
  const a11y = messages.common.a11y
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
      setError(registerCopy.errors.captchaLoadFailed)
    } finally {
      setIsCaptchaLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }
    void loadCaptcha()
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Form validation
    const normalizedUsername = username.trim().toLowerCase()

    if (!normalizedUsername || !phone.trim() || !password.trim() || !confirmPassword.trim() || !captchaCode.trim()) {
      setError(registerCopy.errors.missingFields)
      return
    }

    if (!emailPattern.test(normalizedUsername)) {
      setError(registerCopy.errors.invalidEmail)
      return
    }
    
    if (password !== confirmPassword) {
      setError(registerCopy.errors.passwordMismatch)
      return
    }
    
    if (password.length < 6) {
      setError(registerCopy.errors.passwordLength)
      return
    }

    if (!captchaToken) {
      setError(registerCopy.errors.captchaLoadFailed)
      return
    }

    setError("")

    try {
      const success = await register({
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
          onClose()
          onSwitchToLogin()
        }, 2000)
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.message.includes("captcha")) {
          setError(registerCopy.errors.invalidCaptcha)
          void loadCaptcha()
          return
        }
        if (err.message.includes("valid email")) {
          setError(registerCopy.errors.invalidEmail)
          return
        }
        if (err.message.includes("already registered")) {
          setError(registerCopy.errors.usernameExists)
          void loadCaptcha()
          return
        }
      }
      setError(registerCopy.errors.generic)
      void loadCaptcha()
    }
  }

  const handleClose = () => {
    setUsername("")
    setPhone("")
    setPassword("")
    setConfirmPassword("")
    setCaptchaCode("")
    setCaptchaToken("")
    setCaptchaImage("")
    setError("")
    setSuccess(false)
    onClose()
  }

  if (success) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={handleClose}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="relative w-full max-w-md"
            >
              <Card className="border-border/40 bg-background/95 backdrop-blur-lg shadow-2xl">
                <CardContent className="p-8 text-center">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <UserPlus className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{successCopy.title}</h3>
                  <p className="text-muted-foreground mb-4">{successCopy.message}</p>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-full max-w-md"
          >
              <Card className="border-border/40 bg-background/95 backdrop-blur-lg shadow-2xl">
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-2xl font-bold">{registerCopy.title}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClose}
                    className="h-8 w-8 rounded-full hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">{a11y.close}</span>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">{registerCopy.subtitle}</p>
              </CardHeader>

              <CardContent className="space-y-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-username" className="text-sm font-medium">
                      {registerCopy.usernameLabel}
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reg-username"
                        type="email"
                        placeholder={registerCopy.usernamePlaceholder}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-10"
                        disabled={isLoading}
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-phone" className="text-sm font-medium">
                      {registerCopy.phoneLabel}
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reg-phone"
                        type="tel"
                        placeholder={registerCopy.phonePlaceholder}
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
                      {registerCopy.passwordLabel}
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reg-password"
                        type={showPassword ? "text" : "password"}
                        placeholder={registerCopy.passwordPlaceholder}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10"
                        disabled={isLoading}
                        autoComplete="new-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                        disabled={isLoading}
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
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="reg-captcha" className="text-sm font-medium">
                        {registerCopy.captchaLabel}
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
                        {registerCopy.refreshCaptcha}
                      </Button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-14 w-40 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                        {captchaImage ? (
                          <img src={captchaImage} alt={registerCopy.captchaImageAlt} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs text-muted-foreground">{registerCopy.captchaLoading}</span>
                        )}
                      </div>
                      <Input
                        id="reg-captcha"
                        type="text"
                        placeholder={registerCopy.captchaPlaceholder}
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

                  <div className="space-y-2">
                    <Label htmlFor="reg-confirm-password" className="text-sm font-medium">
                      {registerCopy.confirmPasswordLabel}
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reg-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder={registerCopy.confirmPasswordPlaceholder}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10 pr-10"
                        disabled={isLoading}
                        autoComplete="new-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        disabled={isLoading}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="sr-only">
                          {showConfirmPassword ? a11y.hidePassword : a11y.showPassword}
                        </span>
                      </Button>
                    </div>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-md bg-destructive/10 border border-destructive/20 p-3"
                    >
                      <p className="text-sm text-destructive">{error}</p>
                    </motion.div>
                  )}

                  <Button
                    type="submit"
                    className="w-full rounded-full"
                    disabled={isLoading}
                  >
                    {isLoading ? registerCopy.submitting : registerCopy.submit}
                  </Button>
                </form>

                <div className="text-center text-sm text-muted-foreground">
                  <p>{registerCopy.alreadyHaveAccount}</p>
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-primary"
                    onClick={onSwitchToLogin}
                    disabled={isLoading}
                  >
                    {registerCopy.loginCta}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
