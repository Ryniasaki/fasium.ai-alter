import { fetchWithTimeout } from "./fetch-with-timeout";
import type { TaskStatusPayload } from "./task-status-message";
import { notifyTaskActivity } from "./task-activity";

const API_BASE_URL = "/api";

export interface VideoGenerationResponse {
  taskId: string;
  tenantTaskId?: string;
  status: "PENDING" | "created" | "SUCCESS" | "FAILED";
  message?: TaskStatusPayload;
}

export interface TaskStatusResponse {
  taskId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  progress?: number;
  message?: TaskStatusPayload;
}

export interface CompleteTaskResponse {
  outputs: string[];
}

export class VideoGenerationApiClient {
  private baseUrl: string = API_BASE_URL;

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return (
      localStorage.getItem("token") || localStorage.getItem("auth_token")
    );
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private getFormHeaders(): HeadersInit {
    const headers: HeadersInit = {};
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private async makeRequest(url: string, options: RequestInit = {}) {
    const res = await fetchWithTimeout(url, options);
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("auth_token");
        window.location.href = "/";
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "请求失败");
    }
    return res;
  }

  async submitVideoGeneration(
    file: File,
    prompt: string
  ): Promise<VideoGenerationResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("prompt", prompt);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_video_generation`,
      {
        method: "POST",
        headers: this.getFormHeaders(),
        body: form,
      }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "video_generation", action: "created" });
    return data;
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/${taskId}`,
      { headers: this.getHeaders() }
    );
    return res.json();
  }

  async completeTask(taskId: string): Promise<CompleteTaskResponse> {
    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/${taskId}/complete`,
      { method: "POST", headers: this.getHeaders() }
    );
    const data = await res.json();
    const outputs: string[] = [];

    const storagePaths =
      (Array.isArray(data.storagePaths) && data.storagePaths) ||
      (Array.isArray(data.storage_paths) && data.storage_paths) ||
      [];

    if (storagePaths.length > 0) {
      for (const entry of storagePaths) {
        const rawPath =
          typeof entry === "string"
            ? entry
            : entry?.original || entry?.localPath || null;

        if (!rawPath) continue;

        const relative = rawPath.replace(/^\.?[\\\/]?output[\\\/]/i, "");
        outputs.push(
          `${this.baseUrl}/proxy/static/images/${relative.replace(/\\/g, "/")}`
        );
      }
    } else if (Array.isArray(data.outputs)) {
      for (const item of data.outputs) {
        if (!item) continue;
        if (typeof item === "string") {
          outputs.push(item);
        } else if (
          typeof item === "object" &&
          "localPath" in item &&
          typeof item.localPath === "string"
        ) {
          const relative = item.localPath.replace(/^\.?[\\\/]?output[\\\/]/i, "");
          outputs.push(
            `${this.baseUrl}/proxy/static/images/${relative.replace(
              /\\/g,
              "/"
            )}`
          );
        } else if (
          typeof item === "object" &&
          "fileUrl" in item &&
          typeof item.fileUrl === "string"
        ) {
          outputs.push(item.fileUrl);
        }
      }
    }

    return { outputs };
  }

}

export const videoGenerationApiClient = new VideoGenerationApiClient();
