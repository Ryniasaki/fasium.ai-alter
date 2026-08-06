"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Shield, Hash, Trash2, CirclePlus, Search, KeyRound } from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"

type CreditCode = {
  code: string
  credit: number
  used: boolean
  used_by?: string | null
  created_at?: string
}

type AdminUser = {
  id: number
  username: string
  email?: string | null
  tenant_id?: number
  group?: number
  credit?: number
  created_at?: string
}

type BillingRate = {
  id?: number
  model: string
  credit: number
  created_at?: string
  updated_at?: string
}

type ImageProviderSettings = {
  image_provider?: "poloapi" | "vod"
  use_vod?: boolean
  detail?: string
}

export default function AdminPage() {
  const { user, isAuthenticated, token } = useAuth()
  const router = useRouter()

  const [codes, setCodes] = useState<CreditCode[]>([])
  const [creditValue, setCreditValue] = useState(500)
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [userLoading, setUserLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [userPage, setUserPage] = useState(1)
  const [search, setSearch] = useState("")
  const [applyModalUser, setApplyModalUser] = useState<AdminUser | null>(null)
  const [applyCodeInput, setApplyCodeInput] = useState("")
  const [billingRates, setBillingRates] = useState<BillingRate[]>([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingSettingsLoading, setBillingSettingsLoading] = useState(false)
  const [billingEnabled, setBillingEnabled] = useState(true)
  const [billingEdits, setBillingEdits] = useState<Record<string, number>>({})
  const [newBillingModel, setNewBillingModel] = useState("")
  const [newBillingCredit, setNewBillingCredit] = useState(1)
  const [billingSuggestions, setBillingSuggestions] = useState<string[]>([])
  const [imageProviderLoading, setImageProviderLoading] = useState(false)
  const [imageProviderError, setImageProviderError] = useState<string | null>(null)
  const [useVodProvider, setUseVodProvider] = useState(false)
  const [newAccountName, setNewAccountName] = useState("")
  const [newAccountPassword, setNewAccountPassword] = useState("")
  const [newAccountLoading, setNewAccountLoading] = useState(false)
  const [newAccountError, setNewAccountError] = useState<string | null>(null)
  const [createdAccount, setCreatedAccount] = useState<{ username: string; password: string } | null>(null)
  const [managerName, setManagerName] = useState("")
  const [managerPassword, setManagerPassword] = useState("")
  const [managerCredit, setManagerCredit] = useState(1000)
  const [managerMaxActiveEmployees, setManagerMaxActiveEmployees] = useState(5)
  const [managerLoading, setManagerLoading] = useState(false)
  const [managerError, setManagerError] = useState<string | null>(null)
  const [createdManager, setCreatedManager] = useState<{ username: string; password: string } | null>(null)

  const randomCodePreview = useMemo(() => Math.random().toString(36).slice(-10).toUpperCase(), [])

  const generateDefaultUsername = useCallback(() => {
    const suffix = Math.floor(10000000 + Math.random() * 90000000)
    return `tester${suffix}@fasium.com`
  }, [])

  const generateRandomPassword = useCallback(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
    let result = ""
    for (let i = 0; i < 12; i += 1) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/")
      return
    }
    if (user?.group !== 1000) {
      router.push("/dashboard")
      return
    }
    void fetchCodes()
    void fetchUsers(1, search)
    void fetchBillingRates()
    void fetchBillingSettings()
    void fetchImageProviderSettings()
  }, [isAuthenticated, router, user?.group])

  const fetchCodes = async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/credit-codes", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "加载积分码失败")
      }
      const data = await res.json()
      setCodes(Array.isArray(data?.codes) ? (data.codes as CreditCode[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载积分码失败")
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUsers = async (page = 1, searchTerm = "") => {
    if (!token) return
    setUserLoading(true)
    setUserError(null)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("page_size", "20")
      if (searchTerm) params.set("search", searchTerm)
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "加载用户失败")
      }
      const data = await res.json()
      setUsers(Array.isArray(data?.items) ? (data.items as AdminUser[]) : [])
      setTotalUsers(typeof data?.total === "number" ? data.total : 0)
      setUserPage(page)
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "加载用户失败")
    } finally {
      setUserLoading(false)
    }
  }

  const fetchBillingRates = async () => {
    if (!token) return
    setBillingLoading(true)
    setBillingError(null)
    try {
      const res = await fetch("/api/admin/billing-rates", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "加载计费配置失败")
      }
      const data = await res.json()
      const items = Array.isArray(data?.items) ? (data.items as BillingRate[]) : []
      setBillingRates(items)
      const nextEdits: Record<string, number> = {}
      items.forEach((item) => {
        nextEdits[item.model] = typeof item.credit === "number" ? item.credit : 1
      })
      setBillingEdits(nextEdits)
      await fetchBillingSuggestions()
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "加载计费配置失败")
    } finally {
      setBillingLoading(false)
    }
  }

  const fetchBillingSettings = async () => {
    if (!token) return
    setBillingSettingsLoading(true)
    try {
      const res = await fetch("/api/admin/billing-settings", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = (await res.json().catch(() => ({}))) as { enabled?: boolean; detail?: string }
      if (!res.ok) {
        throw new Error(data.detail || "加载计费模式失败")
      }
      setBillingEnabled(Boolean(data.enabled))
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "加载计费模式失败")
    } finally {
      setBillingSettingsLoading(false)
    }
  }

  const updateBillingSettings = async (enabled: boolean) => {
    if (!token) return
    setBillingSettingsLoading(true)
    try {
      const res = await fetch("/api/admin/billing-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled }),
      })
      const data = (await res.json().catch(() => ({}))) as { enabled?: boolean; detail?: string }
      if (!res.ok) {
        throw new Error(data.detail || "保存计费模式失败")
      }
      setBillingEnabled(Boolean(data.enabled))
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "保存计费模式失败")
    } finally {
      setBillingSettingsLoading(false)
    }
  }

  const fetchBillingSuggestions = async () => {
    if (!token) return
    try {
      const res = await fetch("/api/admin/billing-rates/suggestions", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      const models = Array.isArray(data?.models) ? (data.models as string[]) : []
      setBillingSuggestions(models)
    } catch {
      /* ignore */
    }
  }

  const fetchImageProviderSettings = async () => {
    if (!token) return
    setImageProviderLoading(true)
    setImageProviderError(null)
    try {
      const res = await fetch("/api/admin/image-provider-settings", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = (await res.json().catch(() => ({}))) as ImageProviderSettings
      if (!res.ok) {
        throw new Error(data.detail || "加载图像服务配置失败")
      }
      setUseVodProvider(Boolean(data.use_vod))
    } catch (err) {
      setImageProviderError(err instanceof Error ? err.message : "加载图像服务配置失败")
    } finally {
      setImageProviderLoading(false)
    }
  }

  const updateImageProviderSettings = async (enabled: boolean) => {
    if (!token) return
    setImageProviderLoading(true)
    setImageProviderError(null)
    try {
      const res = await fetch("/api/admin/image-provider-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ use_vod: enabled }),
      })
      const data = (await res.json().catch(() => ({}))) as ImageProviderSettings
      if (!res.ok) {
        throw new Error(data.detail || "保存图像服务配置失败")
      }
      setUseVodProvider(Boolean(data.use_vod))
    } catch (err) {
      setImageProviderError(err instanceof Error ? err.message : "保存图像服务配置失败")
    } finally {
      setImageProviderLoading(false)
    }
  }

  const mergedBillingRates = useMemo(() => {
    const map = new Map<string, BillingRate>()
    billingRates.forEach((rate) => map.set(rate.model, rate))
    billingSuggestions.forEach((model) => {
      if (!map.has(model)) {
        map.set(model, { model, credit: 1 })
      }
    })
    return Array.from(map.values()).sort((a, b) => a.model.localeCompare(b.model))
  }, [billingRates, billingSuggestions])

  const handleUpsertBillingRate = async (model: string, credit: number) => {
    if (!token) return
    const trimmed = model.trim()
    if (!trimmed) return
    setBillingError(null)
    try {
      const res = await fetch("/api/admin/billing-rates", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: trimmed, credit }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "保存计费配置失败")
      }
      const data = await res.json().catch(() => ({}))
      const item = data?.item as BillingRate | undefined
      if (item) {
        setBillingRates((prev) => {
          const exists = prev.some((rate) => rate.model === item.model)
          if (exists) {
            return prev.map((rate) => (rate.model === item.model ? { ...rate, ...item } : rate))
          }
          return [item, ...prev]
        })
        setBillingEdits((prev) => ({ ...prev, [item.model]: item.credit }))
      } else {
        await fetchBillingRates()
      }
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "保存计费配置失败")
    }
  }

  const handleDeleteBillingRate = async (model: string) => {
    if (!token) return
    setBillingError(null)
    try {
      const res = await fetch(`/api/admin/billing-rates/${encodeURIComponent(model)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "删除计费配置失败")
      }
      setBillingRates((prev) => prev.filter((rate) => rate.model !== model))
      setBillingEdits((prev) => {
        const next = { ...prev }
        delete next[model]
        return next
      })
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "删除计费配置失败")
    }
  }

  const handleCreate = async () => {
    if (!token) return
    setIsCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/credit-codes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ credit: creditValue }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "创建积分码失败")
      }
      await fetchCodes()
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建积分码失败")
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async (code: string) => {
    if (!token) return
    setError(null)
    try {
      const res = await fetch(`/api/admin/credit-codes/${code}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "删除失败")
      }
      setCodes((prev) => prev.filter((item) => item.code !== code))
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    }
  }

  const handleApplyCode = async () => {
    if (!token || !applyModalUser || !applyCodeInput) return
    setUserError(null)
    try {
      const res = await fetch(`/api/admin/users/${applyModalUser.id}/apply-credit-code`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: applyCodeInput.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "应用积分码失败")
      }
      const data = await res.json()
      const updated = data?.user as AdminUser | undefined
      if (updated) {
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)))
      } else {
        await fetchUsers(userPage, search)
      }
      await fetchCodes()
      setApplyModalUser(null)
      setApplyCodeInput("")
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "应用积分码失败")
    }
  }

  const handleCreateAccount = async () => {
    if (!token) return
    setNewAccountError(null)
    setNewAccountLoading(true)
    const username = newAccountName.trim() || generateDefaultUsername()
    const password = newAccountPassword || generateRandomPassword()
    try {
      if (!user?.tenant_id) {
        throw new Error("无法获取租户信息")
      }
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password, tenant_id: user.tenant_id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data.detail as string) || "创建用户失败")
      }
      setCreatedAccount({ username, password })
      setNewAccountName("")
      setNewAccountPassword("")
      await fetchUsers(userPage, search)
    } catch (err) {
      setNewAccountError(err instanceof Error ? err.message : "创建用户失败")
    } finally {
      setNewAccountLoading(false)
    }
  }

  const handleCopyAccount = async (account: { username: string; password: string }) => {
    try {
      await navigator.clipboard.writeText(`账号: ${account.username}\n密码: ${account.password}`)
    } catch {
      /* ignore */
    }
  }

  const handleCreateManager = async () => {
    if (!token) return
    setManagerError(null)
    setManagerLoading(true)
    const username = managerName.trim()
    const password = managerPassword || generateRandomPassword()
    try {
      if (!user?.tenant_id) {
        throw new Error("无法获取租户信息")
      }
      if (!username) {
        throw new Error("请填写 manager 用户名")
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
        throw new Error("manager 用户名必须是邮箱地址")
      }
      const res = await fetch("/api/admin/managers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          tenant_id: user.tenant_id,
          credit: managerCredit,
          max_active_employees: managerMaxActiveEmployees,
          is_active: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data.detail as string) || "创建 manager 失败")
      }
      setCreatedManager({ username, password })
      setManagerName("")
      setManagerPassword("")
      setManagerCredit(1000)
      setManagerMaxActiveEmployees(5)
      await fetchUsers(1, "")
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : "创建 manager 失败")
    } finally {
      setManagerLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-6 py-12 max-w-5xl">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Shield className="size-6" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Admin Console</p>
              <h1 className="text-3xl font-bold leading-tight md:text-4xl">管理中心</h1>
              <p className="text-muted-foreground mt-2">需要管理员权限。积分码管理已作为子功能，后续可扩展更多选项。</p>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <Tabs defaultValue="overview" className="w-full min-w-0 lg:flex-1">
              <TabsList className="bg-muted/40 flex flex-wrap">
                <TabsTrigger value="overview">概览</TabsTrigger>
                <TabsTrigger value="credit-codes">积分码</TabsTrigger>
                <TabsTrigger value="users">用户</TabsTrigger>
                <TabsTrigger value="manager-create">创建Manager</TabsTrigger>
                <TabsTrigger value="new-account">新账号</TabsTrigger>
                <TabsTrigger value="database">数据库</TabsTrigger>
                <TabsTrigger value="billing">计费</TabsTrigger>
              </TabsList>

            <TabsContent value="overview" className="mt-6">
              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">概览</CardTitle>
                  <p className="text-sm text-muted-foreground">后续可补充用户统计、操作日志等。</p>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-6 text-muted-foreground">
                    管理员：{user?.username ?? "—"}（group {user?.group ?? "未知"}）
                  </div>
                  <div className="mt-4 flex justify-end">
                    <div className="flex flex-wrap gap-3">
                      <Button asChild variant="outline" className="rounded-full">
                        <Link href="/admin/broadcasts">广播管理</Link>
                      </Button>
                      <Button asChild className="rounded-full">
                        <Link href="/admin/stats">打开使用时长统计</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="mt-6 border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">图像服务</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    切换是否使用 VOD 图像服务。保存后会直接更新 tenant 的 `.env` 中 `IMAGE_PROVIDER`。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {imageProviderError && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                      {imageProviderError}
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 px-4 py-4">
                    <div className="space-y-1 pr-4">
                      <p className="font-medium">启用 VOD</p>
                      <p className="text-sm text-muted-foreground">
                        关闭时使用现有 PoloAPI/Gemini 风格服务，开启时使用腾讯云点播 VOD。
                      </p>
                      <p className="text-xs text-muted-foreground">
                        当前提供方：{useVodProvider ? "vod" : "poloapi"}。修改后需要重启 tenant 服务。
                      </p>
                    </div>
                    <Switch
                      checked={useVodProvider}
                      onCheckedChange={(checked) => void updateImageProviderSettings(checked)}
                      disabled={imageProviderLoading || !token}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="credit-codes" className="mt-6 space-y-6">
              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {error}
                </div>
              )}

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CirclePlus className="size-5 text-primary" />
                    创建积分码
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">额度为单次写入 credit，创建后即刻保存。</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">随机积分码示例（创建后后端生成）</label>
                      <Input value={randomCodePreview} readOnly className="bg-background border-border text-foreground" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">额度</label>
                      <Input
                        type="number"
                        min={0}
                        value={creditValue}
                        onChange={(e) => setCreditValue(Number(e.target.value))}
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button className="rounded-full" onClick={handleCreate} disabled={isCreating || isLoading || !token}>
                      {isCreating ? "创建中..." : "创建"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hash className="size-5 text-primary" />
                    当前积分码
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">展示可用 / 已用的积分码。</p>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                      加载中…
                    </div>
                  ) : codes.length === 0 ? (
                    <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                      暂无积分码
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {codes.map((code) => (
                        <div
                          key={code.code}
                          className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-3"
                        >
                          <div className="flex-1">
                            <p className="font-semibold">{code.code}</p>
                            <p className="text-xs text-muted-foreground">
                              额度：{code.credit} · {code.used ? `已被 ${code.used_by ?? "未知用户"} 使用` : "未使用"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => handleDelete(code.code)}
                            disabled={isLoading}
                          >
                            <Trash2 className="mr-1 size-4" />
                            移除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="users" className="mt-6 space-y-6">
              {userError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {userError}
                </div>
              )}
              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="size-5 text-primary" />
                    用户列表
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    当前总数：{totalUsers}，每页最多 20 个。支持用户名/邮箱模糊搜索。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
                      <Search className="size-4 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索用户名或邮箱"
                        className="border-0 bg-transparent text-foreground focus-visible:ring-0"
                      />
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => fetchUsers(1, search)}
                      disabled={userLoading || !token}
                    >
                      查询
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-card/60">
                    {userLoading ? (
                      <div className="px-4 py-8 text-center text-muted-foreground">加载中…</div>
                    ) : users.length === 0 ? (
                      <div className="px-4 py-8 text-center text-muted-foreground">暂无用户</div>
                    ) : (
                      <div className="divide-y divide-border/40">
                        {users.map((u) => (
                          <div key={u.id} className="px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
                            <div className="flex-1 min-w-[220px]">
                              <p className="font-semibold">{u.username}</p>
                              <p className="text-sm text-muted-foreground">
                                邮箱：{u.email ?? "—"} · 租户：{u.tenant_id ?? "—"} · 组：{u.group ?? "—"} · 信用：
                                {u.credit ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground/70">
                                创建时间：{u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                className="rounded-full"
                                onClick={() => {
                                  setApplyModalUser(u)
                                  setApplyCodeInput("")
                                }}
                                disabled={userLoading || !token}
                              >
                                应用积分码
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      第 {userPage} 页 / 共 {Math.ceil(totalUsers / 20) || 1} 页
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => fetchUsers(Math.max(1, userPage - 1), search)}
                        disabled={userPage <= 1 || userLoading}
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() =>
                          fetchUsers(totalUsers > userPage * 20 ? userPage + 1 : userPage, search)
                        }
                        disabled={userLoading || totalUsers <= userPage * 20}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="manager-create" className="mt-6 space-y-6">
              {managerError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {managerError}
                </div>
              )}
              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">快速创建 Manager</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    创建后默认启用，角色为 manager，可在 dashboard 中管理其 employee 账号。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">Manager 用户名</label>
                      <Input
                        value={managerName}
                        onChange={(e) => setManagerName(e.target.value)}
                        placeholder="例如 manager@company.com"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">密码（可选）</label>
                      <Input
                        value={managerPassword}
                        onChange={(e) => setManagerPassword(e.target.value)}
                        placeholder="留空自动生成随机密码"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">初始点数</label>
                      <Input
                        type="number"
                        min={0}
                        value={managerCredit}
                        onChange={(e) => setManagerCredit(Number(e.target.value))}
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm text-muted-foreground">最多同时启用 employee 数</label>
                      <Input
                        type="number"
                        min={1}
                        value={managerMaxActiveEmployees}
                        onChange={(e) => setManagerMaxActiveEmployees(Math.max(1, Number(e.target.value) || 1))}
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button className="rounded-full" onClick={handleCreateManager} disabled={managerLoading || !token}>
                      {managerLoading ? "创建中..." : "创建 Manager"}
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setManagerPassword(generateRandomPassword())}
                      disabled={managerLoading}
                    >
                      生成随机密码
                    </Button>
                  </div>
                  {createdManager && (
                    <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-4">
                      <p className="text-sm font-semibold mb-2">Manager 创建成功</p>
                      <div className="text-sm text-muted-foreground">
                        账号：{createdManager.username}
                        <br />
                        密码：{createdManager.password}
                      </div>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => void handleCopyAccount(createdManager)}
                        >
                          复制账号密码
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="new-account" className="mt-6 space-y-6">
              {newAccountError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {newAccountError}
                </div>
              )}
              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">快速创建新账号</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    默认用户名为 tester{`{随机8位数字}`}@fasium.com，密码随机生成。也可以自定义用户名。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">用户名（可选）</label>
                      <Input
                        value={newAccountName}
                        onChange={(e) => setNewAccountName(e.target.value)}
                        placeholder="留空将自动生成 testerxxxxxxxx@fasium.com"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">密码（可选）</label>
                      <Input
                        value={newAccountPassword}
                        onChange={(e) => setNewAccountPassword(e.target.value)}
                        placeholder="留空将自动生成随机密码"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button className="rounded-full" onClick={handleCreateAccount} disabled={newAccountLoading || !token}>
                      {newAccountLoading ? "创建中..." : "创建账号"}
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setNewAccountName(generateDefaultUsername())
                        setNewAccountPassword(generateRandomPassword())
                      }}
                      disabled={newAccountLoading}
                    >
                      生成一组
                    </Button>
                  </div>
                  {createdAccount && (
                    <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-4">
                      <p className="text-sm font-semibold mb-2">新账号已创建</p>
                      <div className="text-sm text-muted-foreground">
                        账号：{createdAccount.username}
                        <br />
                        密码：{createdAccount.password}
                      </div>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => void handleCopyAccount(createdAccount)}
                        >
                          点击复制账号密码
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="database" className="mt-6 space-y-6">
              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">数据库管理</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    进入实时数据库控制台，可对租户和用户数据进行增删改查（仅在 tenant 服务启用数据库模式时可用）。
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card/60 px-4 py-6">
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>支持 SQLite / MySQL，操作立即同步至 tenant 服务。</p>
                      <p>仅限管理员使用，请谨慎操作。</p>
                    </div>
                    <Button asChild className="rounded-full">
                      <Link href="/admin/db">打开数据库工具</Link>
                    </Button>
                    <Button asChild variant="outline" className="rounded-full">
                      <Link href="/admin/stats">使用时长统计</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="billing" className="mt-6 space-y-6">
              {billingError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {billingError}
                </div>
              )}

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">计费模式</CardTitle>
                  <p className="text-sm text-muted-foreground">关闭计费后，所有任务消耗为 0。</p>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-foreground">{billingEnabled ? "已开启计费" : "已关闭计费"}</p>
                    <p className="text-xs text-muted-foreground">仅管理员可修改。</p>
                  </div>
                  <Switch
                    checked={billingEnabled}
                    onCheckedChange={(checked) => void updateBillingSettings(checked)}
                    disabled={billingSettingsLoading || !token}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">模型计费配置</CardTitle>
                  <p className="text-sm text-muted-foreground">按模型类型设置扣点额度，未配置则默认为 1。</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">模型名称</label>
                      <Input
                        value={newBillingModel}
                        onChange={(e) => setNewBillingModel(e.target.value)}
                        placeholder="如 gpt-4.1 / gemini-2.5-flash / runninghub:generate"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">扣点</label>
                      <Input
                        type="number"
                        min={0}
                        value={newBillingCredit}
                        onChange={(e) => setNewBillingCredit(Number(e.target.value))}
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  </div>
                  <Button
                    className="rounded-full"
                    onClick={() => {
                      void handleUpsertBillingRate(newBillingModel, newBillingCredit)
                      setNewBillingModel("")
                      setNewBillingCredit(1)
                    }}
                    disabled={billingLoading || !token || !newBillingModel.trim()}
                  >
                    添加/更新
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg">当前计费规则</CardTitle>
                  <p className="text-sm text-muted-foreground">修改后点击保存即可生效。</p>
                </CardHeader>
                <CardContent>
                  {billingLoading ? (
                    <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                      加载中…
                    </div>
                  ) : mergedBillingRates.length === 0 ? (
                    <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                      暂无计费配置
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {mergedBillingRates.map((rate) => (
                        <div
                          key={rate.model}
                          className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-3"
                        >
                          <div className="flex-1 min-w-[220px]">
                            <p className="font-semibold">{rate.model}</p>
                            <p className="text-xs text-muted-foreground">
                              上次更新：{rate.updated_at ? new Date(rate.updated_at).toLocaleString() : "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={billingEdits[rate.model] ?? rate.credit}
                              onChange={(e) =>
                                setBillingEdits((prev) => ({
                                  ...prev,
                                  [rate.model]: Number(e.target.value),
                                }))
                              }
                              className="w-24 bg-background border-border text-foreground"
                            />
                            <Button
                              size="sm"
                              className="rounded-full"
                              onClick={() =>
                                handleUpsertBillingRate(rate.model, billingEdits[rate.model] ?? rate.credit)
                              }
                              disabled={billingLoading || !token}
                            >
                              保存
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              onClick={() => handleDeleteBillingRate(rate.model)}
                              disabled={billingLoading || !token}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            </Tabs>
            <Button asChild variant="outline" className="rounded-full lg:shrink-0">
              <Link href="/admin/reset-password">
                <KeyRound className="mr-2 size-4" />
                重置密码
              </Link>
            </Button>
          </div>
      </div>
      {applyModalUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur px-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">为 {applyModalUser.username} 应用积分码</h3>
            <p className="text-sm text-muted-foreground mb-4">输入积分码后将立即生效，并标记积分码为已使用。</p>
            <Input
              placeholder="请输入积分码"
              value={applyCodeInput}
              onChange={(e) => setApplyCodeInput(e.target.value.trim())}
              className="bg-background border-border text-foreground"
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setApplyModalUser(null)
                  setApplyCodeInput("")
                }}
              >
                取消
              </Button>
              <Button
                className="rounded-full"
                onClick={handleApplyCode}
                disabled={!applyCodeInput || userLoading || !token}
              >
                确认应用
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
