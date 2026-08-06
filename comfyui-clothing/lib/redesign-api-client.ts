import { notifyTaskActivity } from "./task-activity";

import { fetchWithTimeout } from "./fetch-with-timeout"

/**
 * Redesign API Client
 * Handles image upload and redesign requests through Next.js API routes
 */

const API_BASE_URL = "/api"; // 使用 Next.js API 路由
const IMAGE_EDIT_SUBMIT_TIMEOUT_MS = 60000;

export interface RedesignRequest {
  prompt: string;
  image: File;
  image_2?: File | null;
  image_3?: File | null;
  image_4?: File | null;
  model?: string;
  outputCount?: number;
}

export type RedesignImageInput = File | string;

export interface RedesignPoloapiRequest {
  prompt: string;
  image: RedesignImageInput;
  image_2?: RedesignImageInput | null;
  image_3?: RedesignImageInput | null;
  image_4?: RedesignImageInput | null;
  model?: string;
  projectId?: string;
  outputCount?: number;
}

type RecoveredProjectImage = {
  sourceUrl: string;
  recoveredUrl: string;
  previewUrl?: string | null;
};

export interface TextToImageRequest {
  prompt: string;
  model?: string;
  outputCount?: number;
}

export interface RedesignResponse {
  taskId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  message: string;
  outputs?: string[];
}

export interface RedesignPoloapiResponse {
  tenantTaskId?: string;
  tenantTaskIds?: string[];
  storagePaths?: Array<
    | string
    | {
        original?: string | null;
        localPath?: string | null;
        thumbnail?: string | null;
        thumbnailPath?: string | null;
      }
  >;
  status?: string;
}

export interface PoloapiTaskCompletionResult {
  taskId: string;
  outputs: string[];
  output?: string | null;
  error?: string | null;
}

export interface PoloapiTaskStatusResponse {
  tenantTaskId?: string;
  status?: string;
  storagePaths?: Array<
    | string
    | {
        original?: string | null;
        localPath?: string | null;
        thumbnail?: string | null;
        thumbnailPath?: string | null;
      }
  >;
  errorMessage?: string;
}

export interface TaskStatusResponse {
  taskId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  progress?: number;
  message?: string;
}

export class RedesignApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") {
      console.log("getToken - window is undefined, returning null");
      return null;
    }

    // 尝试从不同的 localStorage key 获取 token
    const token =
      localStorage.getItem("token") || localStorage.getItem("auth_token");
    console.log(
      "getToken - retrieved token:",
      token ? `${token.substring(0, 20)}...` : "null"
    );
    return token;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private getFormDataHeaders(): HeadersInit {
    const headers: HeadersInit = {};

    const token = this.getToken();
    console.log("getFormDataHeaders - token:", token);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      console.log("getFormDataHeaders - headers:", headers);
    } else {
      console.warn("getFormDataHeaders - No token found!");
    }

    return headers;
  }

  private isRecoverableImageReferenceError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return (
      message.includes("image reference not found") ||
      message.includes("image reference fetch failed")
    );
  }

  private async imageInputToFile(
    value: RedesignImageInput,
    field: string
  ): Promise<File> {
    if (value instanceof File) {
      return value;
    }

    const response = await fetchWithTimeout(value, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to fetch retry image: ${response.status}`);
    }

    const blob = await response.blob();
    return this.normalizeBlobToSupportedImageFile(blob, field);
  }

  private isSupportedUploadMimeType(type: string | null | undefined): boolean {
    return [
      "image/gif",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ].includes((type || "").toLowerCase());
  }

  private async convertBlobToPng(blob: Blob): Promise<Blob> {
    if (typeof window === "undefined") {
      throw new Error("Cannot convert image blob outside the browser");
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Failed to decode image blob"));
        element.src = objectUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to create canvas context for image conversion");
      }
      context.drawImage(image, 0, 0);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error("Failed to encode PNG blob"));
        }, "image/png");
      });

      return pngBlob;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private async normalizeBlobToSupportedImageFile(
    blob: Blob,
    field: string
  ): Promise<File> {
    if (this.isSupportedUploadMimeType(blob.type)) {
      const type = blob.type.toLowerCase();
      const extension = type.split("/")[1] || "png";
      return new File([blob], `${field}-${Date.now()}.${extension}`, { type });
    }

    const pngBlob = await this.convertBlobToPng(blob);
    return new File([pngBlob], `${field}-${Date.now()}.png`, {
      type: "image/png",
    });
  }

  private async dataUrlToFile(dataUrl: string, field: string): Promise<File> {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to decode data URL for ${field}`);
    }
    const blob = await response.blob();
    return this.normalizeBlobToSupportedImageFile(blob, field);
  }

  private isServerStorageReference(value: string): boolean {
    const raw = value.trim();
    if (!raw) return false;
    if (raw.startsWith("/api/proxy/static/images/")) return true;
    if (raw.startsWith("/proxy/static/images/")) return true;
    if (raw.startsWith("/static/images/")) return true;
    return /^https?:\/\/[^/]+\/(?:api\/proxy\/static\/images|proxy\/static\/images|static\/images)\//i.test(raw);
  }

  private async normalizeRequestImagesToFiles(
    request: RedesignPoloapiRequest
  ): Promise<RedesignPoloapiRequest> {
    const normalized: RedesignPoloapiRequest = { ...request };
    normalized.image = await this.imageInputToFile(request.image, "file");
    if (request.image_2) {
      normalized.image_2 = await this.imageInputToFile(request.image_2, "file_2");
    }
    if (request.image_3) {
      normalized.image_3 = await this.imageInputToFile(request.image_3, "file_3");
    }
    if (request.image_4) {
      normalized.image_4 = await this.imageInputToFile(request.image_4, "file_4");
    }
    return normalized;
  }

  private async uploadRecoveredImageToProject(
    projectId: string,
    file: File
  ): Promise<{ originalUrl: string; previewUrl?: string | null }> {
    const formData = new FormData();
    formData.append("files", file, file.name);
    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/projects/${projectId}/uploads`,
      {
        method: "POST",
        headers: this.getFormDataHeaders(),
        body: formData,
      }
    );
    const data = await response.json().catch(() => null);
    const record = Array.isArray((data as { records?: unknown }).records)
      ? (
          (data as {
            records: Array<{ image_urls?: string[]; thumbnail_urls?: string[] }>;
          }).records ?? []
        )[0]
      : null;
    const originalUrl = record?.image_urls?.[0] || record?.thumbnail_urls?.[0];
    const previewUrl = record?.thumbnail_urls?.[0] || record?.image_urls?.[0];
    if (!originalUrl) {
      throw new Error("Upload response missing image URL");
    }
    return { originalUrl, previewUrl };
  }

  private dispatchRecoveredProjectImages(
    projectId: string,
    recoveries: RecoveredProjectImage[]
  ): void {
    if (typeof window === "undefined" || recoveries.length === 0) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("board-project-image-recovered", {
        detail: {
          projectId,
          recoveries,
        },
      })
    );
  }

  private async recoverRequestImagesToProjectStorage(
    request: RedesignPoloapiRequest
  ): Promise<{
    recoveredRequest: RedesignPoloapiRequest;
    recoveries: RecoveredProjectImage[];
  }> {
    if (!request.projectId) {
      throw new Error("Project ID is required for asset recovery");
    }

    const fields: Array<keyof Pick<
      RedesignPoloapiRequest,
      "image" | "image_2" | "image_3" | "image_4"
    >> = ["image", "image_2", "image_3", "image_4"];
    const recoveredRequest: RedesignPoloapiRequest = { ...request };
    const recoveries: RecoveredProjectImage[] = [];

    for (const field of fields) {
      const value = request[field];
      if (typeof value !== "string" || value.length === 0) {
        continue;
      }
      const file = await this.imageInputToFile(value, field === "image" ? "file" : field);
      const upload = await this.uploadRecoveredImageToProject(request.projectId, file);
      recoveredRequest[field] = upload.originalUrl;
      recoveries.push({
        sourceUrl: value,
        recoveredUrl: upload.originalUrl,
        previewUrl: upload.previewUrl,
      });
    }

    return { recoveredRequest, recoveries };
  }

  private async uploadImageInputToProject(
    projectId: string,
    value: RedesignImageInput,
    field: string,
  ): Promise<string> {
    if (value instanceof File) {
      const upload = await this.uploadRecoveredImageToProject(projectId, value);
      return upload.originalUrl;
    }
    if (value.startsWith("data:")) {
      const file = await this.dataUrlToFile(value, field);
      const upload = await this.uploadRecoveredImageToProject(projectId, file);
      return upload.originalUrl;
    }
    const file = await this.imageInputToFile(value, field);
    const upload = await this.uploadRecoveredImageToProject(projectId, file);
    return upload.originalUrl;
  }

  private async normalizeRequestImagesToServerUrls(
    request: RedesignPoloapiRequest
  ): Promise<RedesignPoloapiRequest> {
    const normalized: RedesignPoloapiRequest = { ...request };
    const fields: Array<keyof Pick<
      RedesignPoloapiRequest,
      "image" | "image_2" | "image_3" | "image_4"
    >> = ["image", "image_2", "image_3", "image_4"];

    for (const field of fields) {
      const value = request[field];
      if (!value) continue;
      if (typeof value === "string" && this.isServerStorageReference(value)) {
        continue;
      }
      if (!request.projectId) {
        throw new Error("Project ID is required to upload local image references");
      }
      normalized[field] = await this.uploadImageInputToProject(request.projectId, value, field);
    }

    return normalized;
  }

  private buildPoloapiFormData(request: RedesignPoloapiRequest): FormData {
    const formData = new FormData();
    const appendImageField = (
      field: string,
      value?: File | string | null
    ) => {
      if (!value) return;
      if (typeof value === "string") {
        formData.append(`${field}_url`, value);
        return;
      }
      throw new Error(`Unexpected binary image input for ${field}`);
    };
    const hasImage =
      Boolean(request.image) ||
      Boolean(request.image_2) ||
      Boolean(request.image_3) ||
      Boolean(request.image_4);
    if (hasImage) {
      formData.append("fileType", "image");
    }
    appendImageField("file", request.image);
    formData.append("prompt", request.prompt);
    if (request.model) {
      formData.append("model", request.model);
    }
    if (typeof request.outputCount === "number") {
      formData.append("output_count", String(request.outputCount));
    }
    if (request.projectId) {
      formData.append("project_id", request.projectId);
    }
    formData.append("async_mode", "true");

    appendImageField("file_2", request.image_2);
    appendImageField("file_3", request.image_3);
    appendImageField("file_4", request.image_4);
    return formData;
  }

  private mapStoragePathsToUrls(
    storagePaths: Array<
      string | {
        original?: string | null;
        localPath?: string | null;
        thumbnail?: string | null;
        thumbnailPath?: string | null;
      }
    >
  ): string[] {
    return storagePaths
      .map(
        (
          entry: string | {
            original?: string | null;
            localPath?: string | null;
            thumbnail?: string | null;
            thumbnailPath?: string | null;
          }
        ) => {
          const rawPath =
            typeof entry === "string"
              ? entry
              : entry?.original || entry?.localPath || entry?.thumbnail || entry?.thumbnailPath || null;

          if (!rawPath) {
            return null;
          }

          const relativePath = rawPath.replace(/^output[\\\/]/, "");
          return `${this.baseUrl}/proxy/static/images/${relativePath.replace(
            /\\/g,
            "/"
          )}`;
        }
      )
      .filter((url): url is string => Boolean(url));
  }

  /**
   * 处理401未授权错误
   */
  private handleUnauthorized(): void {
    if (typeof window !== "undefined") {
      // 清除本地存储的token
      localStorage.removeItem("token");
      localStorage.removeItem("auth_token");

      // 重定向到主页
      window.location.href = "/";
    }
  }

  /**
   * 通用请求方法，处理401错误
   */
  private async makeRequest(
    url: string,
    options: RequestInit = {},
    timeoutMs?: number
  ): Promise<Response> {
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (!response.ok) {
      // 处理401未授权错误
      if (response.status === 401) {
        this.handleUnauthorized();
        throw new Error("Token已失效，请重新登录");
      }

      const error = await response.json().catch(() => null);
      const errorMessage =
        (error as { detail?: string } | null)?.detail ||
        (error as { error?: { message?: string } } | null)?.error?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage || "请求失败");
    }

    return response;
  }

  /**
   * Upload image to get image name for processing
   */
  async uploadImage(image: File): Promise<{ imageName: string }> {
    const formData = new FormData();
    formData.append("file", image);
    formData.append("fileType", "image"); // Default file type for images

    const headers = this.getFormDataHeaders();
    console.log("Upload request headers:", headers);
    console.log("Token:", this.getToken());

    const response = await this.makeRequest(`${this.baseUrl}/proxy/upload`, {
      method: "POST",
      headers: headers,
      body: formData,
    });

    console.log("Upload response status:", response.status);
    console.log(
      "Upload response headers:",
      Object.fromEntries(response.headers.entries())
    );

    const result = await response.json();
    return { imageName: result.fileName || result.imageName };
  }

  /**
   * Submit redesign request using complete_image_edit endpoint
   */
  async submitRedesign(request: RedesignRequest): Promise<RedesignResponse> {
    // Use the new complete_image_edit endpoint that handles upload and edit in one call
    const formData = new FormData();
    formData.append("file", request.image);
    formData.append("fileType", "image");
    formData.append("prompt", request.prompt);

    // 添加额外的图片（如果提供）
    if (request.image_2) {
      formData.append("file_2", request.image_2);
    }
    if (request.image_3) {
      formData.append("file_3", request.image_3);
    }
    if (request.image_4) {
      formData.append("file_4", request.image_4);
    }
    if (typeof request.outputCount === "number") {
      formData.append("output_count", String(request.outputCount));
    }

    const headers = this.getFormDataHeaders();
    console.log("Complete image edit request headers:", headers);

    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_image_edit`,
      {
        method: "POST",
        headers: headers,
        body: formData,
      }
    );

    console.log("Complete image edit response status:", response.status);

    const result = await response.json();
    notifyTaskActivity({ source: "redesign", action: "created" });
    return result;
  }

  async submitRedesignWithPoloapi(
    request: RedesignPoloapiRequest
  ): Promise<{ outputs: string[]; tenantTaskId?: string; tenantTaskIds?: string[]; taskResults?: PoloapiTaskCompletionResult[] }> {
    const result = await this.submitRedesignTaskWithPoloapi(request);
    const tenantTaskId = result.tenantTaskId;
    const tenantTaskIds = Array.isArray(result.tenantTaskIds)
      ? result.tenantTaskIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const storagePaths = Array.isArray(result.storagePaths)
      ? result.storagePaths
      : [];
    if (storagePaths.length === 0 && tenantTaskId) {
      return this.waitForPoloapiTaskCompletion(tenantTaskId);
    }
    if (storagePaths.length === 0 && tenantTaskIds.length > 0) {
      return this.waitForMultiplePoloapiTaskCompletion(tenantTaskIds);
    }
    return {
      outputs: this.mapStoragePathsToUrls(storagePaths),
      tenantTaskId,
      tenantTaskIds,
    };
  }

  async submitRedesignTaskWithPoloapi(
    request: RedesignPoloapiRequest
  ): Promise<RedesignPoloapiResponse> {
    const headers = this.getFormDataHeaders();
    const normalizedRequest = await this.normalizeRequestImagesToServerUrls(request);
    const submit = async (payload: RedesignPoloapiRequest) => {
      const response = await this.makeRequest(
        `${this.baseUrl}/proxy/complete_image_edit_poloapi`,
        {
          method: "POST",
          headers: headers,
          body: await this.buildPoloapiFormData(payload),
        },
        IMAGE_EDIT_SUBMIT_TIMEOUT_MS
      );
      const result: RedesignPoloapiResponse = await response.json();
      notifyTaskActivity({ source: "redesign", action: "created" });
      return result;
    };

    try {
      return await submit(normalizedRequest);
    } catch (error) {
      const hasUrlBasedImage = [normalizedRequest.image, normalizedRequest.image_2, normalizedRequest.image_3, normalizedRequest.image_4].some(
        (item) => typeof item === "string" && item.length > 0
      );
      if (!hasUrlBasedImage || !this.isRecoverableImageReferenceError(error)) {
        throw error;
      }
      if (request.projectId) {
        try {
          const { recoveredRequest, recoveries } =
            await this.recoverRequestImagesToProjectStorage(request);
          this.dispatchRecoveredProjectImages(request.projectId, recoveries);
          return await submit(recoveredRequest);
        } catch (recoveryError) {
          console.warn("Project asset recovery failed, falling back to direct file retry:", recoveryError);
        }
      }
      const retryRequest = await this.normalizeRequestImagesToFiles(request);
      return submit(retryRequest);
    }
  }

  async submitTextToImageWithPoloapi(
    request: TextToImageRequest
  ): Promise<{ outputs: string[]; tenantTaskId?: string; tenantTaskIds?: string[]; taskResults?: PoloapiTaskCompletionResult[] }> {
    const result = await this.submitTextToImageTaskWithPoloapi(request);
    const tenantTaskId = result.tenantTaskId;
    const tenantTaskIds = Array.isArray(result.tenantTaskIds)
      ? result.tenantTaskIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const storagePaths = Array.isArray(result.storagePaths)
      ? result.storagePaths
      : [];
    if (storagePaths.length === 0 && tenantTaskId) {
      const statusResult = await this.pollPoloapiTaskCompletion(tenantTaskId);
      return {
        outputs: this.mapStoragePathsToUrls(statusResult.storagePaths || []),
        tenantTaskId,
      };
    }
    if (storagePaths.length === 0 && tenantTaskIds.length > 0) {
      return this.waitForMultiplePoloapiTaskCompletion(tenantTaskIds);
    }
    return {
      outputs: this.mapStoragePathsToUrls(storagePaths),
      tenantTaskId,
      tenantTaskIds,
    };
  }

  async submitTextToImageTaskWithPoloapi(
    request: TextToImageRequest
  ): Promise<RedesignPoloapiResponse> {
    const formData = new FormData();
    formData.append("prompt", request.prompt);
    if (request.model) {
      formData.append("model", request.model);
    }
    if (typeof request.outputCount === "number") {
      formData.append("output_count", String(request.outputCount));
    }
    formData.append("async_mode", "true");

    const headers = this.getFormDataHeaders();

    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_image_edit_poloapi`,
      {
        method: "POST",
        headers: headers,
        body: formData,
      },
      IMAGE_EDIT_SUBMIT_TIMEOUT_MS
    );

    const result = await response.json();
    notifyTaskActivity({ source: "redesign", action: "created" });
    return result;
  }

  async waitForMultiplePoloapiTaskCompletion(
    taskIds: string[],
    maxAttempts: number = 120,
    intervalMs: number = 2500
  ): Promise<{ outputs: string[]; tenantTaskId?: string; tenantTaskIds?: string[]; taskResults: PoloapiTaskCompletionResult[] }> {
    const settled = await Promise.allSettled(
      taskIds.map(async (taskId) => {
        const result = await this.waitForPoloapiTaskCompletion(taskId, maxAttempts, intervalMs);
        return {
          taskId,
          outputs: result.outputs,
          output: result.outputs[0] || null,
        } satisfies PoloapiTaskCompletionResult;
      }),
    );
    const taskResults: PoloapiTaskCompletionResult[] = settled.map((item, index): PoloapiTaskCompletionResult => {
      if (item.status === "fulfilled") {
        return item.value;
      }
      return {
        taskId: taskIds[index] || "",
        outputs: [],
        output: null,
        error: item.reason instanceof Error ? item.reason.message : "PoloAPI task failed",
      } satisfies PoloapiTaskCompletionResult;
    }).filter((item) => Boolean(item.taskId));
    const outputs = taskResults.flatMap((item) => item.outputs);
    if (outputs.length === 0) {
      const rejectedCount = settled.filter((item) => item.status === "rejected").length;
      throw new Error(`All parallel image tasks failed (${rejectedCount}/${taskIds.length})`);
    }
    return {
      outputs,
      tenantTaskId: taskIds[0],
      tenantTaskIds: taskIds,
      taskResults,
    };
  }

  async getPoloapiTaskStatus(
    taskId: string
  ): Promise<PoloapiTaskStatusResponse> {
    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/poloapi/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: this.getHeaders(),
      }
    );
    return await response.json();
  }

  async pollPoloapiTaskCompletion(
    taskId: string,
    maxAttempts: number = 120,
    intervalMs: number = 2500
  ): Promise<PoloapiTaskStatusResponse> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      const status = await this.getPoloapiTaskStatus(taskId);
      const normalized = String(status.status || "PENDING").toUpperCase();
      if (normalized === "SUCCESS" || normalized === "COMPLETED") {
        return status;
      }
      if (normalized === "FAILED" || normalized === "ERROR") {
        throw new Error(status.errorMessage || "PoloAPI task failed");
      }
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("PoloAPI task polling timeout");
  }

  async waitForPoloapiTaskCompletion(
    taskId: string,
    maxAttempts: number = 120,
    intervalMs: number = 2500
  ): Promise<{ outputs: string[]; tenantTaskId?: string }> {
    const statusResult = await this.pollPoloapiTaskCompletion(
      taskId,
      maxAttempts,
      intervalMs
    );
    return {
      outputs: this.mapStoragePathsToUrls(statusResult.storagePaths || []),
      tenantTaskId: taskId,
    };
  }

  /**
   * Check task status
   */
  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/${taskId}`,
      {
        method: "GET",
        headers: this.getHeaders(),
      }
    );

    return await response.json();
  }

  /**
   * Complete task and automatically download/store images
   */
  async completeTask(taskId: string): Promise<{ outputs: string[] }> {
    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/${taskId}/complete`,
      {
        method: "POST",
        headers: this.getHeaders(),
      }
    );

    const data = await response.json();

    // 将存储路径转换为可访问的URL
    if (data.storagePaths && Array.isArray(data.storagePaths)) {
      return { outputs: this.mapStoragePathsToUrls(data.storagePaths) };
    }

    return { outputs: [] };
  }

  /**
   * Get task outputs when completed (stored version) - DEPRECATED
   * Use completeTask instead
   */
  async getTaskOutputs(taskId: string): Promise<{ outputs: string[] }> {
    // 重定向到新的completeTask方法
    return this.completeTask(taskId);
  }

  /**
   * Poll task status until completion and automatically complete task
   */
  async pollTaskCompletion(
    taskId: string,
    onStatusUpdate?: (status: TaskStatusResponse) => void,
    maxAttempts: number = 60,
    intervalMs: number = 5000
  ): Promise<TaskStatusResponse & { outputs?: string[] }> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const status = await this.getTaskStatus(taskId);

        if (onStatusUpdate) {
          onStatusUpdate(status);
        }

        if (status.status === "SUCCESS") {
          // 任务成功完成，自动下载和存储图片
          try {
            const outputs = await this.completeTask(taskId);
            return { ...status, outputs: outputs.outputs };
          } catch (error) {
            console.error("Error completing task:", error);
            return status;
          }
        } else if (status.status === "FAILED") {
          return status;
        }

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        console.error("Error polling task status:", error);
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error("Task polling timeout");
  }

  /**
   * 获取用户的任务历史记录
   */
  async getTaskHistory(page: number = 1, taskType?: string, limit?: number): Promise<TaskHistoryItem[]> {
    const qs = new URLSearchParams({ page: String(page) });
    if (taskType) qs.set('task_type', taskType);
    if (limit) qs.set('limit', String(limit));
    const response = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/history?${qs.toString()}`,
      {
        method: "GET",
        headers: this.getHeaders(),
      }
    );

    return response.json();
  }

  async getTaskHistoryCount(taskType?: string): Promise<number> {
    const qs = new URLSearchParams();
    if (taskType) {
      qs.set("task_type", taskType);
    }

    const path = `/proxy/tasks/history-count${qs.toString() ? `?${qs.toString()}` : ""}`;
    const altPath = `/proxy/tasks/history/count${qs.toString() ? `?${qs.toString()}` : ""}`;

    const tryRequest = async (route: string): Promise<number | null> => {
      const response = await this.makeRequest(`${this.baseUrl}${route}`, {
        method: "GET",
        headers: this.getHeaders(),
      });

      const data = await response.json().catch(() => null);
      if (response.ok && data && typeof data.total === "number") {
        return data.total;
      }
      return null;
    };

    const primary = await tryRequest(path);
    if (primary !== null) {
      return primary;
    }

    const fallback = await tryRequest(altPath);
    if (fallback !== null) {
      return fallback;
    }

    return 0;
  }

  async refreshTaskStatuses(tenantTaskIds: string[]): Promise<TaskStatusRefreshResponse> {
    if (!Array.isArray(tenantTaskIds) || tenantTaskIds.length === 0) {
      return { tasks: [], checked_ids: [], updated_count: 0, removed_ids: [] };
    }

    const response = await this.makeRequest(`${this.baseUrl}/proxy/tasks/refresh-status`, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_task_ids: tenantTaskIds }),
    });

    const data = await response.json().catch(() => null);

    if (
      data &&
      typeof data === "object" &&
      data !== null
    ) {
      const removedIds = Array.isArray((data as Record<string, unknown>).removed_ids)
        ? ((data as Record<string, unknown>).removed_ids as unknown[]).filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          )
        : []
      return {
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        checked_ids: Array.isArray(data.checked_ids) ? data.checked_ids : [],
        updated_count: typeof data.updated_count === "number" ? data.updated_count : 0,
        removed_ids: removedIds,
      };
    }

    return { tasks: [], checked_ids: [], updated_count: 0, removed_ids: [] };
  }

  async refreshPoloapiTaskStatuses(tenantTaskIds: string[]): Promise<TaskStatusRefreshResponse> {
    if (!Array.isArray(tenantTaskIds) || tenantTaskIds.length === 0) {
      return { tasks: [], checked_ids: [], updated_count: 0, removed_ids: [] };
    }

    type PoloapiTaskStatusRefreshEntry = {
      checkedId: string;
      task?: TaskHistoryItem;
      removedId?: string;
    };

    const results = await Promise.allSettled(
      tenantTaskIds.map(async (taskId): Promise<PoloapiTaskStatusRefreshEntry> => {
        const response = await fetchWithTimeout(
          `${this.baseUrl}/proxy/poloapi/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "GET",
            headers: this.getHeaders(),
          },
        );

        const data = await response.json().catch(() => null) as PoloapiTaskStatusResponse | null;
        const status = String(data?.status || "PENDING").toUpperCase();

        if (response.status === 401) {
          this.handleUnauthorized();
          throw new Error("Token已失效，请重新登录");
        }

        if (response.status === 404) {
          return {
            checkedId: taskId,
            removedId: taskId,
          };
        }

        if (!response.ok) {
          const errorMessage =
            (data as { detail?: string; errorMessage?: string; message?: string } | null)?.detail ||
            (data as { detail?: string; errorMessage?: string; message?: string } | null)?.errorMessage ||
            (data as { detail?: string; errorMessage?: string; message?: string } | null)?.message ||
            `HTTP ${response.status}: ${response.statusText}`;
          throw new Error(errorMessage);
        }

        const storagePaths = Array.isArray(data?.storagePaths) ? data.storagePaths : [];
        const outputs = this.mapStoragePathsToUrls(storagePaths);
        const normalizedStoragePaths = storagePaths.map((entry) =>
          typeof entry === "string"
            ? entry
            : {
                original: entry.original ?? entry.localPath ?? entry.thumbnail ?? entry.thumbnailPath ?? null,
                thumbnail: entry.thumbnail ?? entry.thumbnailPath ?? entry.original ?? entry.localPath ?? null,
                localPath: entry.localPath ?? null,
              },
        );
        return {
          checkedId: taskId,
          task: {
            id: 0,
            tenant_task_id: taskId,
            user_id: "",
            runninghub_task_id: "",
            task_type: "",
            status,
            created_at: "",
            completed_at: null,
            result_data: data,
            storage_paths: normalizedStoragePaths,
            thumbnail_paths: normalizedStoragePaths,
            image_urls: outputs,
            thumbnail_urls: outputs,
            error_message: data?.errorMessage ?? null,
          } satisfies TaskHistoryItem,
        };
      }),
    );

    const tasks: TaskHistoryItem[] = [];
    const checkedIds: string[] = [];
    const removedIds: string[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.checkedId) {
          checkedIds.push(result.value.checkedId);
        }
        if (result.value.removedId) {
          removedIds.push(result.value.removedId);
        }
        if (result.value.task) {
          tasks.push(result.value.task);
        }
      }
    }

    return {
      tasks,
      checked_ids: checkedIds,
      updated_count: tasks.length,
      removed_ids: removedIds,
    };
  }

  async getTaskTypes(): Promise<string[]> {
    const response = await this.makeRequest(`${this.baseUrl}/proxy/tasks/types`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    const data: TaskTypesResponse | null = await response.json().catch(() => null);

    if (data && Array.isArray(data.types)) {
      return data.types;
    }

    return [];
  }

  async deleteTaskHistory(taskIds?: string[], taskType?: string): Promise<number> {
    const body: Record<string, unknown> = {};
    if (taskIds && taskIds.length > 0) {
      body.task_ids = taskIds;
    }
    if (taskType) {
      body.task_type = taskType;
    }

    const response = await this.makeRequest(`${this.baseUrl}/proxy/tasks/history`, {
      method: "DELETE",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (typeof data?.deleted === "number") {
      return data.deleted;
    }
    return 0;
  }
}

export interface TaskHistoryItem {
  id: number;
  tenant_task_id: string;
  user_id: string;
  runninghub_task_id: string;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  result_data: any;
  storage_paths: Array<string | { original?: string | null; thumbnail?: string | null; localPath?: string | null }> | null;
  thumbnail_paths?: Array<string | { original?: string | null; thumbnail?: string | null }> | null;
  image_urls: string[];
  thumbnail_urls?: string[];
  error_message: string | null;
}

export interface TaskStatusRefreshResponse {
  tasks: TaskHistoryItem[];
  checked_ids: string[];
  updated_count: number;
  removed_ids: string[];
}

export interface TaskTypesResponse {
  types: string[];
}

export const redesignApiClient = new RedesignApiClient();
