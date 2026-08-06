import { fetchWithTimeout } from "./fetch-with-timeout"
import type { TaskHistoryItem } from "./extract-api-client"
import type { TaskStatusPayload } from "./task-status-message"
import { notifyTaskActivity } from "./task-activity"

const API_BASE_URL = "/api"

export type AspectRatio = "16:9" | "9:16" | "1:1"

export interface TextToImageResponse {
  taskId: string
  tenantTaskId?: string
  status: "PENDING" | "created" | "SUCCESS" | "FAILED"
  message?: TaskStatusPayload
}

export interface TaskStatusResponse {
  taskId: string
  status: "PENDING" | "SUCCESS" | "FAILED"
  progress?: number
  message?: TaskStatusPayload
}

export interface CompleteTaskResponse {
  outputs: string[]
}

class TextToImageApiClient {
  private baseUrl: string = API_BASE_URL

  private getToken(): string | null {
    if (typeof window === "undefined") return null
    return localStorage.getItem("token") || localStorage.getItem("auth_token")
  }

  private getJsonHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" }
    const token = this.getToken()
    if (token) headers["Authorization"] = `Bearer ${token}`
    return headers
  }

  private getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = {}
    const token = this.getToken()
    if (token) headers["Authorization"] = `Bearer ${token}`
    return headers
  }

  private async makeRequest(url: string, options: RequestInit = {}) {
    const res = await fetchWithTimeout(url, options)
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        localStorage.removeItem("token")
        localStorage.removeItem("auth_token")
        window.location.href = "/"
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || "请求失败")
    }
    return res
  }

  async submitTextToImage(prompt: string, aspectRatio: AspectRatio): Promise<TextToImageResponse> {
    const res = await this.makeRequest(`${this.baseUrl}/proxy/text_to_image`, {
      method: "POST",
      headers: this.getJsonHeaders(),
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspectRatio,
      }),
    })
    const data = await res.json()
    notifyTaskActivity({ source: "text_to_image", action: "created" })
    return data
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const res = await this.makeRequest(`${this.baseUrl}/proxy/tasks/${taskId}`, {
      headers: this.getAuthHeaders(),
    })
    return res.json()
  }

  async completeTask(taskId: string): Promise<CompleteTaskResponse> {
    const res = await this.makeRequest(`${this.baseUrl}/proxy/tasks/${taskId}/complete`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    })
    const data = await res.json()
    const outputs: string[] = []

    const storagePaths =
      (Array.isArray(data.storagePaths) && data.storagePaths) ||
      (Array.isArray(data.storage_paths) && data.storage_paths) ||
      []

    if (storagePaths.length > 0) {
      for (const entry of storagePaths) {
        const rawPath =
          typeof entry === "string" ? entry : entry?.original || entry?.localPath || null

        if (!rawPath) continue

        const relative = rawPath.replace(/^\.?[\\\/]?output[\\\/]/i, "")
        outputs.push(`${this.baseUrl}/proxy/static/images/${relative.replace(/\\/g, "/")}`)
      }
    } else if (Array.isArray(data.outputs)) {
      for (const item of data.outputs) {
        if (!item) continue
        if (typeof item === "string") {
          outputs.push(item)
        } else if (typeof item === "object" && "localPath" in item && typeof item.localPath === "string") {
          const relative = item.localPath.replace(/^\.?[\\\/]?output[\\\/]/i, "")
          outputs.push(`${this.baseUrl}/proxy/static/images/${relative.replace(/\\/g, "/")}`)
        } else if (typeof item === "object" && "fileUrl" in item && typeof item.fileUrl === "string") {
          outputs.push(item.fileUrl)
        }
      }
    }

    return { outputs }
  }

  async getTaskHistory(page: number = 1, limit: number = 10): Promise<TaskHistoryItem[]> {
    const qs = new URLSearchParams({
      page: String(page),
      task_type: "text_to_image",
      limit: String(limit),
    })
    const res = await this.makeRequest(`${this.baseUrl}/proxy/tasks/history?${qs.toString()}`, {
      method: "GET",
      headers: this.getAuthHeaders(),
    })
    return res.json()
  }
}

export const textToImageApiClient = new TextToImageApiClient()
