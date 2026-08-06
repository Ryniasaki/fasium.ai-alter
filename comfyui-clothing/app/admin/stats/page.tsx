"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowLeft, RefreshCw, Timer } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Overview = {
  totalOnlineMs: number
  totalOnlineReadable: string
  totalSessions: number
  activeUsers: number
  totalEvents: number
}

type UserRow = {
  userId: number
  username: string
  totalOnlineMs: number
  totalOnlineReadable: string
  eventCount: number
  sessions: number
  lastSeenAt: string
}

type DayRow = {
  date: string
  totalOnlineMs: number
  totalOnlineReadable: string
  eventCount: number
  activeUsers: number
}

type SessionRow = {
  sessionId: string
  userId: number
  username: string
  pagePath: string
  totalOnlineMs: number
  totalOnlineReadable: string
  eventCount: number
  startedAt: string
  lastSeenAt: string
}

type StatsResponse = {
  range: { from: string; to: string }
  overview: Overview
  byUser: UserRow[]
  byDay: DayRow[]
  sessions: SessionRow[]
}

function toLocalDateTimeInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const min = pad(date.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export default function AdminStatsPage() {
  const { user, token, isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const [from, setFrom] = useState(() => toLocalDateTimeInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
  const [to, setTo] = useState(() => toLocalDateTimeInputValue(new Date()))
  const [username, setUsername] = useState("")
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const fetchStats = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (from) params.set("from", new Date(from).toISOString())
      if (to) params.set("to", new Date(to).toISOString())
      if (username.trim()) params.set("username", username.trim())

      const res = await fetch(`/api/admin/stats/usage?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = (await res.json().catch(() => ({}))) as StatsResponse & { detail?: string }
      if (!res.ok) {
        throw new Error(data.detail || "Failed to load usage statistics")
      }
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage statistics")
    } finally {
      setLoading(false)
    }
  }, [from, to, token, username])

  useEffect(() => {
    if (!token) return
    void fetchStats()
  }, [token, fetchStats])

  const headerSummary = useMemo(() => {
    if (!stats) return "No data"
    return `${formatDateTime(stats.range.from)} - ${formatDateTime(stats.range.to)}`
  }, [stats])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Admin Stats</p>
            <h1 className="text-3xl font-bold">Usage Duration Analytics</h1>
            <p className="text-sm text-muted-foreground">{headerSummary}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/admin">
                <ArrowLeft className="mr-2 size-4" />
                Back to Admin
              </Link>
            </Button>
            <Button
              className="rounded-full"
              onClick={() => void fetchStats()}
              disabled={loading || !token}
            >
              <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs text-muted-foreground">Username (optional)</label>
              <Input
                placeholder="e.g. alice"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <Button className="rounded-full" onClick={() => void fetchStats()} disabled={loading || !token}>
                Query
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Total Online</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold flex items-center gap-2">
              <Timer className="size-5 text-primary" />
              {stats?.overview.totalOnlineReadable || "0h 0m 0s"}
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Active Users</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{stats?.overview.activeUsers ?? 0}</CardContent>
          </Card>
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Sessions</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{stats?.overview.totalSessions ?? 0}</CardContent>
          </Card>
          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Events</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold flex items-center gap-2">
              <Activity className="size-5 text-primary" />
              {stats?.overview.totalEvents ?? 0}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>By User</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Online Duration</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stats?.byUser ?? []).map((row) => (
                  <TableRow key={`${row.userId}-${row.username}`}>
                    <TableCell>{row.userId}</TableCell>
                    <TableCell>{row.username}</TableCell>
                    <TableCell>{row.totalOnlineReadable}</TableCell>
                    <TableCell>{row.sessions}</TableCell>
                    <TableCell>{row.eventCount}</TableCell>
                    <TableCell>{formatDateTime(row.lastSeenAt)}</TableCell>
                  </TableRow>
                ))}
                {(stats?.byUser?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      No user data in selected range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>By Day</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Online Duration</TableHead>
                  <TableHead>Active Users</TableHead>
                  <TableHead>Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stats?.byDay ?? []).map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>{row.totalOnlineReadable}</TableCell>
                    <TableCell>{row.activeUsers}</TableCell>
                    <TableCell>{row.eventCount}</TableCell>
                  </TableRow>
                ))}
                {(stats?.byDay?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No daily data in selected range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>Session Details (Top 200 by online duration)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Entry Page</TableHead>
                  <TableHead>Online Duration</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stats?.sessions ?? []).map((row) => (
                  <TableRow key={row.sessionId}>
                    <TableCell className="font-mono text-xs">{row.sessionId.slice(0, 10)}...</TableCell>
                    <TableCell>{row.username}</TableCell>
                    <TableCell>{row.pagePath}</TableCell>
                    <TableCell>{row.totalOnlineReadable}</TableCell>
                    <TableCell>{formatDateTime(row.startedAt)}</TableCell>
                    <TableCell>{formatDateTime(row.lastSeenAt)}</TableCell>
                  </TableRow>
                ))}
                {(stats?.sessions?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      No session data in selected range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
