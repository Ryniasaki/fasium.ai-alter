export const CREDIT_GUARD_EVENT = "credit-insufficient"

export type CreditGuardDetail = {
  detail?: string
  endpoint?: string
  model?: string
  balance?: number
  required?: number
}

export const notifyCreditInsufficient = (detail?: CreditGuardDetail | string) => {
  if (typeof window === "undefined") return
  const payload = typeof detail === "string" ? { detail } : detail
  window.dispatchEvent(new CustomEvent(CREDIT_GUARD_EVENT, { detail: payload || {} }))
}
