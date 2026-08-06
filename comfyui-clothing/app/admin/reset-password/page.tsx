"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Copy, KeyRound, Loader2, Search } from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type AdminUser = {
  id: number
  username: string
  email?: string | null
  tenant_id?: number
  group?: number
  role?: string
  is_active?: boolean
  credit?: number
  created_at?: string
}

type UsersResponse = {
  total?: number
  items?: AdminUser[]
  detail?: string
}

const PAGE_SIZE = 20
const RESET_PASSWORD_VALUE = "00000000"

export default function AdminResetPasswordPage() {
  const router = useRouter()
  const { user, token, isAuthenticated, isLoading } = useAuth()
  const requestSeqRef = useRef(0)
  const copyTimeoutRef = useRef<number | null>(null)

  const [searchInput, setSearchInput] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [lastResetUsername, setLastResetUsername] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadUsers = useCallback(
    async (targetPage: number, targetSearch: string) => {
      if (!token) return

      const requestId = ++requestSeqRef.current
      const safePage = Math.max(1, targetPage)

      setLoadingUsers(true)
      setListError(null)

      try {
        const params = new URLSearchParams()
        params.set("page", String(safePage))
        params.set("page_size", String(PAGE_SIZE))
        if (targetSearch) {
          params.set("search", targetSearch)
        }

        const res = await fetch(`/api/admin/users?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
        const data = (await res.json().catch(() => ({}))) as UsersResponse
        if (!res.ok) {
          throw new Error(data.detail || "加载用户失败")
        }
        if (requestId !== requestSeqRef.current) return

        setUsers(Array.isArray(data.items) ? data.items : [])
        setTotalUsers(typeof data.total === "number" ? data.total : 0)
        setPage(safePage)
        setAppliedSearch(targetSearch)
      } catch (err) {
        if (requestId !== requestSeqRef.current) return
        setListError(err instanceof Error ? err.message : "加载用户失败")
        setUsers([])
        setTotalUsers(0)
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoadingUsers(false)
        }
      }
    },
    [token],
  )

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.push("/")
      return
    }
    if (user?.group !== 1000) {
      router.push("/dashboard")
    }
  }, [isAuthenticated, isLoading, router, user?.group])

  useEffect(() => {
    if (!token || isLoading || !isAuthenticated || user?.group !== 1000) return
    void loadUsers(1, "")
  }, [token, isAuthenticated, isLoading, user?.group, loadUsers])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleSearch = () => {
    const nextSearch = searchInput.trim()
    void loadUsers(1, nextSearch)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      handleSearch()
    }
  }

  const handleSelectUser = (targetUser: AdminUser) => {
    setSelectedUser(targetUser)
    setResetError(null)
    setLastResetUsername(null)
    setCopied(false)
  }

  const handleResetPassword = async () => {
    if (!token || !selectedUser) return

    const confirmed = window.confirm(`确认将 ${selectedUser.username} 的密码重置为 00000000 吗？`)
    if (!confirmed) return

    setResetting(true)
    setResetError(null)

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = (await res.json().catch(() => ({}))) as { user?: AdminUser; detail?: string }
      if (!res.ok) {
        throw new Error(data.detail || "重置密码失败")
      }

      const updatedUser = data.user
      if (updatedUser) {
        setUsers((prev) => prev.map((item) => (item.id === updatedUser.id ? { ...item, ...updatedUser } : item)))
        setSelectedUser((current) => (current && current.id === updatedUser.id ? { ...current, ...updatedUser } : current))
        setLastResetUsername(updatedUser.username)
      } else {
        setLastResetUsername(selectedUser.username)
      }
      setCopied(false)
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "重置密码失败")
    } finally {
      setResetting(false)
    }
  }

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(RESET_PASSWORD_VALUE)
      setCopied(true)
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      setResetError("复制密码失败")
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
            <KeyRound className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Admin Console</p>
            <h1 className="text-3xl font-bold leading-tight md:text-4xl">重置密码</h1>
            <p className="mt-2 text-muted-foreground">
              搜索并选择一个现有用户，然后将其密码重置为固定值 <span className="font-mono">00000000</span>。
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/admin">
              <ArrowLeft className="mr-2 size-4" />
              返回管理中心
            </Link>
          </Button>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">搜索用户</CardTitle>
              <CardDescription>输入用户名或邮箱进行检索，点击结果即可选中用户。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="flex-1 space-y-2">
                  <label className="text-sm text-muted-foreground">搜索条件</label>
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="输入用户名或邮箱"
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button className="rounded-full" onClick={handleSearch} disabled={loadingUsers || !token}>
                    <Search className="mr-2 size-4" />
                    搜索
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setSearchInput("")
                      void loadUsers(1, "")
                    }}
                    disabled={loadingUsers || !token}
                  >
                    清空
                  </Button>
                </div>
              </div>

              {listError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {listError}
                </div>
              )}

              <div className="rounded-2xl border border-border/60 bg-muted/20">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="font-medium">用户列表</p>
                    <p className="text-xs text-muted-foreground">
                      共 {totalUsers} 条记录{appliedSearch ? ` · 当前筛选「${appliedSearch}」` : ""}
                    </p>
                  </div>
                  {loadingUsers && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      加载中
                    </div>
                  )}
                </div>

                <div className="max-h-[520px] space-y-2 overflow-y-auto p-4">
                  {!loadingUsers && users.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                      {appliedSearch ? "没有找到匹配的用户，请换一个关键词试试。" : "暂无用户可供选择。"}
                    </div>
                  ) : (
                    users.map((item) => {
                      const isSelected = selectedUser?.id === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectUser(item)}
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">{item.username}</p>
                              <p className="truncate text-sm text-muted-foreground">{item.email || "无邮箱"}</p>
                            </div>
                            <Badge variant="outline" className="rounded-full">
                              ID {item.id}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>tenant {item.tenant_id ?? "—"}</span>
                            <span>group {item.group ?? "—"}</span>
                            <span>role {item.role ?? "user"}</span>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
                  <span>
                    第 {page} 页 / 共 {totalPages} 页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void loadUsers(Math.max(1, page - 1), appliedSearch)}
                      disabled={page <= 1 || loadingUsers || !token}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void loadUsers(page < totalPages ? page + 1 : page, appliedSearch)}
                      disabled={page >= totalPages || loadingUsers || !token}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/60 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">当前选择</CardTitle>
                <CardDescription>重置前请先确认目标用户信息。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedUser ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                    从左侧列表中选中一个用户后，再执行重置密码操作。
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-muted-foreground">用户名</p>
                          <p className="truncate text-lg font-semibold">{selectedUser.username}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{selectedUser.email || "无邮箱"}</p>
                        </div>
                        <Badge variant="secondary" className="rounded-full">
                          用户 ID {selectedUser.id}
                        </Badge>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full">
                          tenant {selectedUser.tenant_id ?? "—"}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          group {selectedUser.group ?? "—"}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {selectedUser.role || "user"}
                        </Badge>
                      </div>

                      <p className="mt-4 text-sm text-muted-foreground">
                        点击下方按钮后，系统会将该用户密码重置为 <span className="font-mono">00000000</span>。
                      </p>
                    </div>

                    {resetError && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                        {resetError}
                      </div>
                    )}

                    {lastResetUsername && (
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-50">
                        <div className="flex items-center gap-2 font-semibold">
                          <CheckCircle2 className="size-4" />
                          已重置 {lastResetUsername} 的密码
                        </div>
                        <p className="mt-2 text-emerald-50/90">
                          新密码固定为 <span className="font-mono">00000000</span>。
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="rounded-full border-emerald-200/40 bg-background/10 text-emerald-50 hover:bg-background/20"
                            onClick={handleCopyPassword}
                          >
                            <Copy className="mr-2 size-4" />
                            {copied ? "已复制" : "复制密码"}
                          </Button>
                        </div>
                      </div>
                    )}

                    <Button
                      className="w-full rounded-full"
                      onClick={() => void handleResetPassword()}
                      disabled={resetting || !token}
                    >
                      {resetting ? "重置中..." : "重置为 00000000"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">操作说明</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>1. 使用用户名或邮箱搜索用户。</p>
                <p>2. 选中目标用户后，确认右侧展示的信息。</p>
                <p>3. 点击重置后，密码会变成固定值 <span className="font-mono">00000000</span>。</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  )
}
