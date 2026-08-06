import pantoneFinder from "./pantone-finder.json"

type RgbColor = { r: number; g: number; b: number }

type PantoneEntry = { name: string; r: number; g: number; b: number }

type PantoneFinderEntry = {
  code?: string
  rgb?: string
}

const parseRgbString = (value: string) => {
  const match = value.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i)
  if (!match) return null
  const r = Number.parseInt(match[1], 10)
  const g = Number.parseInt(match[2], 10)
  const b = Number.parseInt(match[3], 10)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r, g, b }
}

const pantoneEntries: PantoneEntry[] = (
  (pantoneFinder as { set1?: PantoneFinderEntry[] }).set1 ?? []
)
  .map((entry) => {
    const rgb = entry.rgb ? parseRgbString(entry.rgb) : null
    if (!rgb || !entry.code) return null
    return { name: entry.code, r: rgb.r, g: rgb.g, b: rgb.b }
  })
  .filter((entry): entry is PantoneEntry => Boolean(entry))

const pantoneCache = new Map<string, PantoneEntry>()

export const findClosestPantone = (color: RgbColor) => {
  const key = `${color.r},${color.g},${color.b}`
  const cached = pantoneCache.get(key)
  if (cached) return cached
  let closest = pantoneEntries[0]
  let minDistance = Number.POSITIVE_INFINITY
  for (const entry of pantoneEntries) {
    const dr = entry.r - color.r
    const dg = entry.g - color.g
    const db = entry.b - color.b
    const distance = dr * dr + dg * dg + db * db
    if (distance < minDistance) {
      minDistance = distance
      closest = entry
    }
  }
  pantoneCache.set(key, closest)
  return closest
}

export const formatPantoneName = (entry?: PantoneEntry | null) => {
  if (!entry?.name) return "PANTONE"
  return entry.name
}
