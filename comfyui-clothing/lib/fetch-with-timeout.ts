export const DEFAULT_FETCH_TIMEOUT_MS = 8000

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, Math.max(1000, timeoutMs))

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
