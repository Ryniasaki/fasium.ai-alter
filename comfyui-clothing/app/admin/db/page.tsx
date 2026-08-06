"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Database, Edit3, PlusCircle, RefreshCw, Trash2, AlertTriangle } from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type TableField = {
  name: string
  label: string
  type: string
  editable: boolean
  required?: boolean
}

type TableMeta = {
  name: string
  label: string
  primary_key: string
  fields: TableField[]
}

type TableListResponse = {
  storage_type?: string
  tables?: TableMeta[]
}

const TENANT_DB_WARNING =
  "当前 Tenant 服务未启用数据库模式（STORAGE_TYPE=sqlite/mysql）。实时数据库管理功能暂不可用。"

export default function AdminDbPage() {
  const router = useRouter()
  const { user, token, isAuthenticated, isLoading } = useAuth()

  const [tables, setTables] = useState<TableMeta[]>([])
  const [storageType, setStorageType] = useState<string>("")
  const [activeTable, setActiveTable] = useState<string>("")
  const [records, setRecords] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [loadingTables, setLoadingTables] = useState(false)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [formValues, setFormValues] = useState<Record<string, any>>({})
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.push("/")
      return
    }
    if (user?.group !== 1000) {
      router.push("/dashboard")
      return
    }
  }, [isAuthenticated, isLoading, router, user?.group])

  const currentTable = useMemo(() => tables.find((item) => item.name === activeTable), [activeTable, tables])
  const visibleFields = useMemo(
    () => (currentTable?.fields ?? []).filter((field) => field.type !== "password"),
    [currentTable]
  )
  const formFields = useMemo(() => (currentTable?.fields ?? []).filter((field) => field.editable), [currentTable])
  const primaryKey = currentTable?.primary_key ?? "id"
  const totalPages = Math.max(1, Math.ceil(total / 20))

  const fetchTables = async () => {
    if (!token) return
    setLoadingTables(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/db/tables", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "加载数据表失败")
      }
      const data = (await res.json().catch(() => ({}))) as TableListResponse
      setStorageType(data.storage_type || "")
      const parsedTables = Array.isArray(data.tables) ? data.tables : []
      setTables(parsedTables)
      if (!activeTable && parsedTables.length > 0) {
        setActiveTable(parsedTables[0].name)
      } else if (activeTable && parsedTables.length > 0) {
        const exists = parsedTables.some((table) => table.name === activeTable)
        if (!exists) {
          setActiveTable(parsedTables[0].name)
        }
      } else if (parsedTables.length === 0) {
        setActiveTable("")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据表失败")
    } finally {
      setLoadingTables(false)
    }
  }

  const fetchRecords = async () => {
    if (!token || !activeTable) return
    setLoadingRecords(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("page_size", "20")
      if (searchTerm.trim()) params.set("search", searchTerm.trim())
      const res = await fetch(`/api/admin/db/${activeTable}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "获取数据失败")
      }
      const data = await res.json().catch(() => ({}))
      setRecords(Array.isArray(data?.items) ? data.items : [])
      setTotal(typeof data?.total === "number" ? data.total : 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取数据失败")
    } finally {
      setLoadingRecords(false)
    }
  }

  useEffect(() => {
    if (!token) return
    void fetchTables()
  }, [token])

  useEffect(() => {
    if (!token || !activeTable) return
    void fetchRecords()
  }, [activeTable, page, token, searchTerm])

  const openForm = (mode: "create" | "edit", record?: any) => {
    setFormMode(mode)
    setSelectedRecord(record ?? null)
    const initial: Record<string, any> = {}
    formFields.forEach((field) => {
      const sourceValue = record?.[field.name]
      if (field.type === "password") {
        initial[field.name] = ""
      } else if (field.type === "boolean") {
        initial[field.name] = mode === "edit" ? Boolean(sourceValue) : true
      } else if (field.type === "json") {
        if (mode === "edit") {
          if (typeof sourceValue === "string") {
            initial[field.name] = sourceValue
          } else if (sourceValue) {
            initial[field.name] = JSON.stringify(sourceValue, null, 2)
          } else {
            initial[field.name] = ""
          }
        } else {
          initial[field.name] = ""
        }
      } else if (field.type === "number") {
        initial[field.name] = mode === "edit" && sourceValue !== undefined && sourceValue !== null ? sourceValue : ""
      } else {
        initial[field.name] = mode === "edit" && sourceValue !== undefined && sourceValue !== null ? sourceValue : ""
      }
    })
    setFormValues(initial)
  }

  const closeForm = () => {
    setFormMode(null)
    setFormValues({})
    setSelectedRecord(null)
  }

  const handleDelete = async (record: any) => {
    if (!token || !activeTable) return
    const id = record?.[primaryKey]
    if (!id) return
    if (!window.confirm("确定要删除该记录吗？")) return
    setError(null)
    try {
      const res = await fetch(`/api/admin/db/${activeTable}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "删除失败")
      }
      await fetchRecords()
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    }
  }

  const handleSubmit = async () => {
    if (!token || !activeTable || !formMode) return
    setSubmitting(true)
    setError(null)
    try {
      if (formMode === "create") {
        const missing = formFields
          .filter((field) => field.required)
          .filter((field) => {
            const value = formValues[field.name]
            if (field.type === "boolean") return false
            if (field.type === "number") {
              return value === "" || value === undefined || value === null
            }
            return value === undefined || value === null || (typeof value === "string" && value.trim() === "")
          })

        if (missing.length > 0) {
          throw new Error(`以下字段必填：${missing.map((field) => field.label).join("、")}`)
        }
      }

      const payload: Record<string, any> = {}
      formFields.forEach((field) => {
        if (!field.editable) return
        const rawValue = formValues[field.name]
        if (field.type === "password" && formMode === "edit" && !rawValue) {
          return
        }
        if (field.type === "boolean") {
          payload[field.name] = Boolean(rawValue)
          return
        }
        if (field.type === "number") {
          if (rawValue === "" || rawValue === null || rawValue === undefined) {
            return
          }
          payload[field.name] = Number(rawValue)
          return
        }
        if (field.type === "json") {
          payload[field.name] = rawValue || ""
          return
        }
        if (rawValue !== undefined) {
          payload[field.name] = rawValue
        }
      })

      const requestInit: RequestInit = {
        method: formMode === "create" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
      let url = `/api/admin/db/${activeTable}`
      if (formMode === "edit") {
        const targetId = selectedRecord?.[primaryKey]
        if (!targetId) throw new Error("无效的记录 ID")
        url += `/${targetId}`
      }
      const res = await fetch(url, requestInit)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.detail as string) || "提交失败")
      }
      closeForm()
      await fetchRecords()
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  const formatValue = (field: TableField, value: any) => {
    if (value === null || value === undefined || value === "") {
      return "—"
    }
    if (field.type === "boolean") {
      return value ? "是" : "否"
    }
    if (field.type === "json") {
      if (typeof value === "string") return value
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    if (field.type === "datetime") {
      try {
        return new Date(value).toLocaleString()
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  const renderFieldInput = (field: TableField) => {
    const value = formValues[field.name] ?? ""
    if (field.type === "boolean") {
      return (
        <div className="flex items-center gap-3">
          <Switch checked={Boolean(value)} onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, [field.name]: checked }))} />
          <span className="text-sm text-neutral-300">{Boolean(value) ? "启用" : "禁用"}</span>
        </div>
      )
    }
    if (field.type === "json") {
      return (
        <Textarea
          value={value}
          onChange={(e) => setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
          placeholder="请输入 JSON 字符串"
          className="bg-neutral-900 border-white/10 text-white"
          rows={4}
        />
      )
    }
    return (
      <Input
        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
        className="bg-neutral-900 border-white/10 text-white"
        placeholder={field.label}
      />
    )
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="bg-gradient-to-br from-primary/10 via-neutral-900 to-neutral-950">
        <div className="container mx-auto max-w-6xl px-6 py-12 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Database className="size-6" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">Admin Console</p>
              <h1 className="text-3xl font-bold leading-tight md:text-4xl">数据库管理</h1>
              <p className="text-neutral-400 mt-2">实时查看与编辑租户服务数据库，支持增删改查。</p>
            </div>
          </div>

          {storageType === "json" && (
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100 flex items-center gap-2">
              <AlertTriangle className="size-4" />
              {TENANT_DB_WARNING}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
          )}

          <div className="grid gap-6 md:grid-cols-[220px,1fr]">
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">数据表</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {loadingTables ? (
                  <div className="text-sm text-neutral-400">加载中…</div>
                ) : tables.length === 0 ? (
                  <div className="text-sm text-neutral-400">暂无可管理的数据表</div>
                ) : (
                  tables.map((table) => (
                    <Button
                      key={table.name}
                      variant={activeTable === table.name ? "default" : "outline"}
                      className="justify-start rounded-full"
                      onClick={() => {
                        setActiveTable(table.name)
                        setPage(1)
                        setFormMode(null)
                        setSelectedRecord(null)
                      }}
                    >
                      {table.label}
                    </Button>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-white/10 bg-white/5 backdrop-blur">
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-lg">{currentTable?.label ?? "未选择"}</CardTitle>
                    <p className="text-sm text-neutral-400">
                      {currentTable ? `共 ${total} 条记录 · 第 ${page} / ${totalPages} 页` : "请选择一个数据表"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => void fetchRecords()}
                      disabled={!activeTable || loadingRecords}
                    >
                      <RefreshCw className="mr-2 size-4" />
                      刷新
                    </Button>
                    <Button
                      className="rounded-full"
                      onClick={() => openForm("create")}
                      disabled={!activeTable}
                    >
                      <PlusCircle className="mr-2 size-4" />
                      新建
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="搜索关键字"
                      className="bg-neutral-900 border-white/10 text-white"
                    />
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setPage(1)
                        setSearchTerm(searchInput.trim())
                      }}
                      disabled={!activeTable || loadingRecords}
                    >
                      查询
                    </Button>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-neutral-900/60">
                    {loadingRecords ? (
                      <div className="px-4 py-12 text-center text-neutral-300">加载中…</div>
                    ) : records.length === 0 ? (
                      <div className="px-4 py-12 text-center text-neutral-300">暂无数据</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {visibleFields.map((field) => (
                                <TableHead key={field.name} className="text-neutral-400">
                                  {field.label}
                                </TableHead>
                              ))}
                              <TableHead className="text-right text-neutral-400">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {records.map((record) => (
                              <TableRow key={record[primaryKey] ?? JSON.stringify(record)}>
                                {visibleFields.map((field) => (
                                  <TableCell key={`${record[primaryKey]}-${field.name}`} className="align-top">
                                    <span className="text-sm">{formatValue(field, record[field.name])}</span>
                                  </TableCell>
                                ))}
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="rounded-full"
                                      onClick={() => openForm("edit", record)}
                                    >
                                      <Edit3 className="size-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="rounded-full"
                                      onClick={() => void handleDelete(record)}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm text-neutral-400">
                    <span>
                      第 {page} / {totalPages} 页
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page <= 1 || loadingRecords}
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setPage((prev) => (prev >= totalPages ? prev : prev + 1))}
                        disabled={page >= totalPages || loadingRecords}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {formMode ? (
                <Card className="border-primary/50 bg-primary/5 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {formMode === "create" ? "创建新记录" : `编辑 ${currentTable?.label ?? ""}`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {formFields.map((field) => (
                      <div key={field.name} className="space-y-2">
                        <label className="text-sm text-neutral-300">{field.label}</label>
                        {renderFieldInput(field)}
                      </div>
                    ))}
                    <div className="flex justify-end gap-3">
                      <Button variant="outline" className="rounded-full" onClick={closeForm}>
                        取消
                      </Button>
                      <Button className="rounded-full" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? "提交中..." : "保存"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
