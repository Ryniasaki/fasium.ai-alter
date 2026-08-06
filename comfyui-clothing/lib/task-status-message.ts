export type TaskStatusPayload =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | Array<unknown>
  | null

const describeStatusValue = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => describeStatusValue(item))
      .filter(Boolean)
      .join(" · ")
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const text = describeStatusValue(val)
        return text ? `${key}: ${text}` : ""
      })
      .filter(Boolean)
    return entries.join(" · ")
  }
  return ""
}

export const formatStatusMessage = (message: TaskStatusPayload, fallback: string): string => {
  if (typeof message === "string") {
    return message.trim() ? message : fallback
  }
  if (typeof message === "number" || typeof message === "boolean") {
    return String(message)
  }
  if (Array.isArray(message)) {
    const joined = describeStatusValue(message)
    return joined || fallback
  }
  if (message && typeof message === "object") {
    const record = message as Record<string, unknown>
    const priorityKeys = ["taskStatus", "message", "detail", "error"]
    for (const key of priorityKeys) {
      const candidate = record[key]
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate
      }
    }
    const promptTips = record["promptTips"]
    if (Array.isArray(promptTips)) {
      const tipsText = promptTips.map((tip) => (typeof tip === "string" ? tip : "")).filter(Boolean).join(" · ")
      if (tipsText) return tipsText
    }
    const described = describeStatusValue(record)
    return described || fallback
  }
  return fallback
}
