"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { apiClient, LoginRequest, RegisterRequest } from "@/lib/api-client"

interface User {
  id: number
  username: string
  email: string | null
  tenant_id: number
  is_active: boolean
  group?: number
  credit?: number
  role?: "manager" | "employee"
  manager_username?: string | null
  max_active_employees?: number
  successful_referrals?: number
  invite_limit?: number
  name?: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (credentials: LoginRequest) => Promise<boolean>
  register: (userData: RegisterRequest) => Promise<boolean>
  refreshUser: () => Promise<User | null>
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const sseRef = React.useRef<EventSource | null>(null)
  const sseTimerRef = React.useRef<number | null>(null)

  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true"

  useEffect(() => {
    if (isDevMode) {
      const mockUser: User = {
        id: 1,
        username: "dev_user",
        email: "dev@example.com",
        tenant_id: 1,
        is_active: true,
      }
      const mockToken = `dev_token_${Date.now()}`
      setUser(mockUser)
      setToken(mockToken)
      localStorage.setItem("auth_user", JSON.stringify(mockUser))
      setIsLoading(false)
      return
    }

    const savedUser = localStorage.getItem("auth_user")
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch {
        localStorage.removeItem("auth_user")
      }
    }

    let isActive = true
    apiClient
      .getUserInfo()
      .then((userInfo) => {
        if (!isActive) return
        setUser(userInfo)
        setToken("__cookie__")
        localStorage.setItem("auth_user", JSON.stringify(userInfo))
      })
      .catch(() => {
        if (!isActive) return
        setUser(null)
        setToken(null)
        localStorage.removeItem("auth_user")
      })
      .finally(() => {
        if (!isActive) return
        setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [isDevMode])

  useEffect(() => {
    if (isDevMode) return
    if (!token || !user?.id) return

    const streamUrl = "/api/credits/stream"

    const connect = () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }

      const sse = new EventSource(streamUrl)
      sseRef.current = sse

      const onCreditUpdate = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string)
          if (typeof payload?.credit === "number") {
            setUser((prev) => {
              if (!prev) return prev
              const next = { ...prev, credit: payload.credit }
              localStorage.setItem("auth_user", JSON.stringify(next))
              return next
            })
            void apiClient
              .getUserInfo()
              .then((userInfo) => {
                setUser(userInfo)
                localStorage.setItem("auth_user", JSON.stringify(userInfo))
              })
              .catch(() => {
                // no-op
              })
          }
        } catch {
          // no-op
        }
      }

      sse.addEventListener("credit_update", onCreditUpdate as EventListener)
      sse.onerror = () => {
        sse.close()
        if (sseTimerRef.current) {
          window.clearTimeout(sseTimerRef.current)
        }
        sseTimerRef.current = window.setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      if (sseTimerRef.current) {
        window.clearTimeout(sseTimerRef.current)
        sseTimerRef.current = null
      }
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
    }
  }, [isDevMode, token, user?.id])

  useEffect(() => {
    if (isDevMode) return
    if (!token && !user) return
    let isActive = true

    const currentToken = token && token !== "__cookie__" ? token : undefined
    apiClient
      .getUserInfo(currentToken)
      .then((userInfo) => {
        if (!isActive) return
        setUser(userInfo)
        setToken((prev) => prev ?? "__cookie__")
        localStorage.setItem("auth_user", JSON.stringify(userInfo))
      })
      .catch((error) => {
        console.warn("Failed to refresh user info:", error)
      })

    return () => {
      isActive = false
    }
  }, [isDevMode, token])

  const refreshUser = React.useCallback(async (): Promise<User | null> => {
    if (isDevMode) {
      return user
    }
    try {
      const currentToken = token && token !== "__cookie__" ? token : undefined
      const userInfo = await apiClient.getUserInfo(currentToken)
      setUser(userInfo)
      setToken((prev) => prev ?? "__cookie__")
      localStorage.setItem("auth_user", JSON.stringify(userInfo))
      return userInfo
    } catch (error) {
      console.warn("Failed to refresh user info:", error)
      return null
    }
  }, [isDevMode, token, user])

  const login = async (credentials: LoginRequest): Promise<boolean> => {
    if (isDevMode) {
      const mockUser: User = {
        id: 1,
        username: credentials.username || "dev_user",
        email: "dev@example.com",
        tenant_id: 1,
        is_active: true,
      }
      const mockToken = `dev_token_${Date.now()}`
      setUser(mockUser)
      setToken(mockToken)
      localStorage.setItem("auth_user", JSON.stringify(mockUser))
      return true
    }

    try {
      setIsLoading(true)
      const response = await apiClient.login(credentials)
      setToken(response.access_token)

      const userInfo = await apiClient.getUserInfo(response.access_token)
      setUser(userInfo)
      localStorage.setItem("auth_user", JSON.stringify(userInfo))
      return true
    } catch (error) {
      console.error("Login failed:", error)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const register = async (userData: RegisterRequest): Promise<boolean> => {
    if (isDevMode) {
      const mockUser: User = {
        id: 1,
        username: userData.username,
        email: userData.email ?? userData.username,
        tenant_id: userData.tenant_id,
        is_active: true,
      }
      const mockToken = `dev_token_${Date.now()}`
      setUser(mockUser)
      setToken(mockToken)
      localStorage.setItem("auth_user", JSON.stringify(mockUser))
      return true
    }

    try {
      setIsLoading(true)
      await apiClient.register(userData)

      const loginResponse = await apiClient.login({
        username: userData.username,
        password: userData.password,
      })

      setToken(loginResponse.access_token)
      const userInfo = await apiClient.getUserInfo(loginResponse.access_token)
      setUser(userInfo)
      localStorage.setItem("auth_user", JSON.stringify(userInfo))
      return true
    } catch (error) {
      console.error("Registration failed:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    void apiClient.logout()
    setUser(null)
    setToken(null)
    localStorage.removeItem("auth_user")
  }

  const isAuthenticated = !!user

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    refreshUser,
    logout,
    isAuthenticated,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
