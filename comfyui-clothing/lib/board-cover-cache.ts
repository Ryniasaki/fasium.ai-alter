"use client"

export type BoardCoverCacheMode = "auto" | "pinned"

export type BoardCoverCacheEntry = {
  src: string
  mode: BoardCoverCacheMode
  projectUpdatedAt?: string | null
  fallbackSrc?: string | null
  storedAt: number
}

export type BoardCoverCache = Record<string, BoardCoverCacheEntry>

const BOARD_COVER_CACHE_STORAGE_KEY_PREFIX = "fasium_board_cover_cache_v2"
const LEGACY_BOARD_COVER_CACHE_STORAGE_KEY_PREFIX = "fasium_board_cover_cache"

const isBoardCoverCacheMode = (value: unknown): value is BoardCoverCacheMode => {
  return value === "auto" || value === "pinned"
}

const isBoardCoverCacheEntry = (value: unknown): value is BoardCoverCacheEntry => {
  if (!value || typeof value !== "object") {
    return false
  }

  const entry = value as Partial<BoardCoverCacheEntry>
  return (
    typeof entry.src === "string" &&
    entry.src.length > 0 &&
    isBoardCoverCacheMode(entry.mode) &&
    typeof entry.storedAt === "number" &&
    Number.isFinite(entry.storedAt)
  )
}

export function buildBoardCoverCacheStorageKey(userId?: number | string | null) {
  return `${BOARD_COVER_CACHE_STORAGE_KEY_PREFIX}:${userId ?? "anon"}`
}

export function purgeLegacyBoardCoverCache() {
  if (typeof window === "undefined") {
    return
  }

  try {
    const keysToRemove: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key) continue
      if (key.startsWith(LEGACY_BOARD_COVER_CACHE_STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key)
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Best effort only. Cache will still naturally fall back to empty state.
  }
}

export function readBoardCoverCache(storageKey: string): BoardCoverCache {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<BoardCoverCache>((acc, [projectId, value]) => {
      if (typeof projectId !== "string" || !isBoardCoverCacheEntry(value)) {
        return acc
      }
      acc[projectId] = value.mode === "auto" ? { ...value, mode: "pinned" } : value
      return acc
    }, {})
  } catch {
    return {}
  }
}

export function writeBoardCoverCache(storageKey: string, value: BoardCoverCache) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch (error) {
    try {
      const slimmed = Object.entries(value).reduce<BoardCoverCache>((acc, [projectId, entry]) => {
        if (!isBoardCoverCacheEntry(entry)) {
          return acc
        }
        acc[projectId] = {
          ...entry,
          src: entry.src.startsWith("data:") ? entry.fallbackSrc || entry.src : entry.src,
        }
        if (acc[projectId].src === entry.fallbackSrc) {
          delete acc[projectId].fallbackSrc
        }
        return acc
      }, {})
      window.localStorage.setItem(storageKey, JSON.stringify(slimmed))
    } catch (fallbackError) {
      console.warn("Failed to persist board cover cache:", fallbackError || error)
    }
  }
}

export function resolveCachedBoardCoverSrc(projectId: string, cache: BoardCoverCache): string | null {
  const entry = cache[projectId]
  if (!entry) {
    return null
  }

  return entry.src
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("Failed to encode image as data URL"))
    reader.readAsDataURL(blob)
  })

export async function captureImageAsDataUrl(imageUrl: string): Promise<string> {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("Missing image URL")
  }

  if (imageUrl.startsWith("data:")) {
    return imageUrl
  }

  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error("Failed to load image")
  }

  const blob = await response.blob()
  if (!blob || blob.size === 0) {
    throw new Error("Image response is empty")
  }

  return blobToDataUrl(blob)
}
