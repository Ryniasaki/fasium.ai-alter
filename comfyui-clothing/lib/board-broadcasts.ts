export type BoardBroadcast = {
  id: number
  title: string
  content_markdown: string
  starts_at: string
  ends_at: string
  display_order: number
  updated_at?: string | null
  is_enabled?: boolean
  created_at?: string | null
}

export const BOARD_BROADCAST_DISMISS_STORAGE_KEY = "fasium_board_broadcast_dismissals"

export function buildBoardBroadcastVersion(broadcast: BoardBroadcast) {
  return `${broadcast.id}:${broadcast.updated_at || broadcast.ends_at || broadcast.starts_at}`
}

export function readDismissedBroadcastVersions(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(BOARD_BROADCAST_DISMISS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function writeDismissedBroadcastVersions(value: Record<string, string>) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(BOARD_BROADCAST_DISMISS_STORAGE_KEY, JSON.stringify(value))
}

export function toLocalDateTimeInputValue(value?: string | null) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hours = `${date.getHours()}`.padStart(2, "0")
  const minutes = `${date.getMinutes()}`.padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function fromLocalDateTimeInputValue(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}
