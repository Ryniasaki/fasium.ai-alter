"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ImagePlus, Megaphone, Pencil, Plus, Save, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import type { BoardBroadcast } from "@/lib/board-broadcasts"
import { fromLocalDateTimeInputValue, toLocalDateTimeInputValue } from "@/lib/board-broadcasts"

type BroadcastFormState = {
  title: string
  content_markdown: string
  starts_at: string
  ends_at: string
  display_order: number
  is_enabled: boolean
}

const buildDefaultForm = (): BroadcastFormState => {
  const start = new Date()
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    title: "",
    content_markdown: "",
    starts_at: toLocalDateTimeInputValue(start.toISOString()),
    ends_at: toLocalDateTimeInputValue(end.toISOString()),
    display_order: 0,
    is_enabled: true,
  }
}

const buildRequestHeaders = (token: string | null, extra: Record<string, string> = {}) => {
  if (!token || token === "__cookie__") {
    return extra
  }
  return { ...extra, Authorization: `Bearer ${token}` }
}

export default function AdminBroadcastsPage() {
  const { user, isAuthenticated, token } = useAuth()
  const router = useRouter()

  const [items, setItems] = useState<BoardBroadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<BroadcastFormState>(buildDefaultForm)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/")
      return
    }
    if (user?.group !== 1000) {
      router.push("/dashboard")
      return
    }
    void fetchBroadcasts()
  }, [isAuthenticated, router, user?.group])

  const minStartValue = useMemo(() => toLocalDateTimeInputValue(new Date().toISOString()), [])

  const fetchBroadcasts = async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/admin/broadcasts", {
        headers: buildRequestHeaders(token),
        cache: "no-store",
      })
      const data = (await response.json().catch(() => ({}))) as { items?: BoardBroadcast[]; detail?: string }
      if (!response.ok) {
        throw new Error(data.detail || "加载广播失败")
      }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载广播失败")
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(buildDefaultForm())
  }

  const startEdit = (item: BoardBroadcast) => {
    setEditingId(item.id)
    setForm({
      title: item.title || "",
      content_markdown: item.content_markdown || "",
      starts_at: toLocalDateTimeInputValue(item.starts_at),
      ends_at: toLocalDateTimeInputValue(item.ends_at),
      display_order: item.display_order || 0,
      is_enabled: item.is_enabled ?? true,
    })
  }

  const handleSave = async () => {
    if (!token) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: form.title.trim(),
        content_markdown: form.content_markdown,
        starts_at: fromLocalDateTimeInputValue(form.starts_at),
        ends_at: fromLocalDateTimeInputValue(form.ends_at),
        display_order: form.display_order,
        is_enabled: form.is_enabled,
      }
      const url = editingId ? `/api/admin/broadcasts/${editingId}` : "/api/admin/broadcasts"
      const method = editingId ? "PATCH" : "POST"
      const response = await fetch(url, {
        method,
        headers: buildRequestHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      })
      const data = (await response.json().catch(() => ({}))) as { item?: BoardBroadcast; detail?: string }
      if (!response.ok) {
        throw new Error(data.detail || "保存广播失败")
      }
      await fetchBroadcasts()
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存广播失败")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!token) return
    if (!window.confirm("确认删除这条广播吗？")) return
    setError(null)
    try {
      const response = await fetch(`/api/admin/broadcasts/${id}`, {
        method: "DELETE",
        headers: buildRequestHeaders(token),
      })
      const data = (await response.json().catch(() => ({}))) as { detail?: string }
      if (!response.ok) {
        throw new Error(data.detail || "删除广播失败")
      }
      setItems((prev) => prev.filter((item) => item.id !== id))
      if (editingId === id) {
        resetForm()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除广播失败")
    }
  }

  const handleUploadImage = async (file: File | null) => {
    if (!file || !token) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/admin/broadcasts/upload", {
        method: "POST",
        headers: buildRequestHeaders(token),
        body: formData,
      })
      const data = (await response.json().catch(() => ({}))) as { url?: string; detail?: string }
      if (!response.ok || !data.url) {
        throw new Error(data.detail || "图片上传失败")
      }
      setForm((prev) => ({
        ...prev,
        content_markdown: `${prev.content_markdown}${prev.content_markdown ? "\n\n" : ""}![插图](${data.url})`,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败")
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Megaphone className="size-6" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Admin Broadcasts</p>
              <h1 className="text-3xl font-bold">广播管理</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                使用 Markdown 编辑正文，可直接插入图片、链接和分段内容。开始时间不能早于当前时刻。
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/admin">
              <ArrowLeft className="mr-2 size-4" />
              返回管理中心
            </Link>
          </Button>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle>{editingId ? "编辑广播" : "新建广播"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">标题</label>
                <Input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="例如：系统升级通知"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">开始时间</label>
                  <Input
                    type="datetime-local"
                    min={editingId ? undefined : minStartValue}
                    value={form.starts_at}
                    onChange={(event) => setForm((prev) => ({ ...prev, starts_at: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">结束时间</label>
                  <Input
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(event) => setForm((prev) => ({ ...prev, ends_at: event.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">显示优先级</label>
                  <Input
                    type="number"
                    value={form.display_order}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, display_order: Number(event.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
                  <div>
                    <p className="font-medium">启用</p>
                    <p className="text-xs text-muted-foreground">关闭后不会在 `/board` 展示</p>
                  </div>
                  <Switch
                    checked={form.is_enabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, is_enabled: checked }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="text-sm text-muted-foreground">正文 Markdown</label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary">
                    <ImagePlus className="size-4" />
                    {uploading ? "上传中..." : "插入图片"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        void handleUploadImage(file)
                        event.currentTarget.value = ""
                      }}
                    />
                  </label>
                </div>
                <Textarea
                  value={form.content_markdown}
                  onChange={(event) => setForm((prev) => ({ ...prev, content_markdown: event.target.value }))}
                  placeholder={"支持 Markdown，例如：\n## 标题\n正文段落\n[打开链接](https://...)"}
                  className="min-h-[320px]"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button className="rounded-full" onClick={() => void handleSave()} disabled={saving || !form.title.trim()}>
                  {editingId ? <Save className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
                  {saving ? "保存中..." : editingId ? "保存修改" : "创建广播"}
                </Button>
                <Button variant="outline" className="rounded-full" onClick={resetForm}>
                  重置
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle>已配置广播</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                  加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-8 text-center text-muted-foreground">
                  还没有广播
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-border/60 bg-card/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{item.title}</p>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                              优先级 {item.display_order || 0}
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                              {item.is_enabled ? "启用中" : "已关闭"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {new Date(item.starts_at).toLocaleString()} - {new Date(item.ends_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => startEdit(item)}>
                            <Pencil className="mr-1 size-4" />
                            编辑
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => void handleDelete(item.id)}>
                            <Trash2 className="mr-1 size-4" />
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
