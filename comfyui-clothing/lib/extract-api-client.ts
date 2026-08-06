import { notifyTaskActivity } from "./task-activity";

import { fetchWithTimeout } from "./fetch-with-timeout"

/**
 * Extract API Client
 * Handles pattern extract workflow via Next.js API proxy
 */

const API_BASE_URL = "/api"; // Next.js API routes
const LLM_IMAGE_ANALYSIS_TIMEOUT_MS = 120000;
const LLM_TEXT_GENERATION_TIMEOUT_MS = 120000;

export interface ExtractResponse {
  taskId: string;
  tenantTaskId?: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "created";
  message: string;
}

export interface PaletteGroup {
  colors: Array<{ r: number; g: number; b: number }>;
  note?: string;
}

export interface StripePatternUnit {
  color: { r: number; g: number; b: number };
  widthPx: number;
}

export interface StripeLLMVariationUnit {
  color: { r: number; g: number; b: number };
  relativeWidth: number;
}

export interface StripeLLMVariation {
  title: string;
  styleNote?: string;
  stripeUnits: StripeLLMVariationUnit[];
}

export interface StripeLLMResponse {
  variations: StripeLLMVariation[];
  guidance?: string;
}

export interface PaletteResponse {
  groups: PaletteGroup[];
  /**
   * Whether the analysed garment primarily features stripe-style prints.
   */
  isStripePattern?: boolean;
  /**
   * Minimal repeating stripe unit when `isStripePattern` is true.
   */
  stripePatternUnit?: StripePatternUnit[];
}

export interface TaskStatusResponse {
  taskId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  progress?: number;
  message?: string;
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

const extractJsonPayload = <T>(raw: string): T | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed
  const jsonMatch = candidate.match(/\{[\s\S]*\}/)
  const target = jsonMatch?.[0] ?? candidate

  const tryParse = (value: string): T | null => {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  const parsed = tryParse(target)
  if (parsed) return parsed

  const repaired = target
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) =>
      match.replace(/[\r\n\t]/g, "").replace(/ {2,}/g, " "),
    )

  return repaired === target ? null : tryParse(repaired)
}

const normalizePaletteResponse = (data: unknown): PaletteResponse => {
  const response = (data as PaletteResponse | null) ?? { groups: [] }
  const stripePatternUnit = Array.isArray(response.stripePatternUnit)
    ? response.stripePatternUnit
    : []

  return {
    ...response,
    groups: Array.isArray(response.groups) ? response.groups : [],
    isStripePattern:
      typeof response.isStripePattern === "boolean"
        ? response.isStripePattern
        : stripePatternUnit.length > 0,
    stripePatternUnit,
  }
}

export class ExtractApiClient {
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

  private async makeRequest(
    url: string,
    options: RequestInit = {},
    timeoutMs?: number,
  ) {
    const res = await fetchWithTimeout(url, options, timeoutMs);
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

  async submitExtract(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_pattern_extract`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "extract", action: "created" });
    return data;
  }

  async submitSeamlessPattern(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_seamless_pattern`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "seamless_pattern", action: "created" });
    return data;
  }

  async requestStripeVariations(payload: {
    stripeUnits: Array<{ color: { r: number; g: number; b: number }; widthPx: number }>;
    paletteGroups?: PaletteGroup[];
    targetCount?: number;
  }): Promise<StripeLLMResponse> {
    const normalizedUnits = Array.isArray(payload.stripeUnits)
      ? payload.stripeUnits.map((unit) => ({
          color: {
            r: Math.max(0, Math.min(255, Math.round(unit.color?.r ?? 0))),
            g: Math.max(0, Math.min(255, Math.round(unit.color?.g ?? 0))),
            b: Math.max(0, Math.min(255, Math.round(unit.color?.b ?? 0))),
          },
          widthPx: Math.max(1, Math.round(unit.widthPx ?? 1)),
        }))
      : [];
    const targetCount = payload.targetCount ?? 4;
    const unitsJson = JSON.stringify(normalizedUnits);
    const paletteJson = JSON.stringify(payload.paletteGroups ?? []);

    const prompt = [
      "我们已经提取了一组条纹印花的最小循环单元，包含RGB颜色与相对宽度数据。",
      "请作为资深纺织图案设计师，基于这些信息构思新的艺术化条纹方案。你可以增减色带数量、调整颜色或宽度，",
      "但需要保持色彩协调、适合服装印花的风格，并确保每个方案的相对宽度可归一化。",
      "",
      "原始条纹单元（widthPx 为相对像素宽度）：",
      unitsJson,
      "",
      "如果有帮助，可参考这些协调配色组（可选）：",
      paletteJson,
      "",
      "请输出一个JSON对象，格式如下：",
      '{ "variations": [ { "title": "方案名称", "styleNote": "风格说明", "stripeUnits": [ { "color": {"r":0-255,"g":0-255,"b":0-255}, "relativeWidth": 0.00 }, ... ] }, ... ], "guidance": "整体建议" }',
      "要求：",
      `1. 给出 ${targetCount} 个左右的方案（如果灵感有限可少于此数，但至少2个）。`,
      "2. 每个方案的 stripeUnits 至少包含 3 条色带，relativeWidth 为 0-1 的小数，并保证总和≈1（允许两位小数误差）。",
      "3. 可以引入新的颜色或调换顺序，但要与原始风格有联系。",
      "4. 仅返回JSON，不要加入额外解释或Markdown。",
    ].join("\n");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/llm/poloapi/chat`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      },
      LLM_TEXT_GENERATION_TIMEOUT_MS,
    );

    const data = await res.json().catch(() => null);
    const rawText = (data as { text?: string } | null)?.text ?? "";
    if (rawText) {
      const parsed = extractJsonPayload<StripeLLMResponse>(rawText)
      return parsed ?? { variations: [], guidance: "" }
    }
    return (data as StripeLLMResponse) ?? { variations: [] };
  }

  async requestColorPalettes(file: File): Promise<PaletteResponse> {
    const form = new FormData();
    form.append("files", file, file.name);
    // 通过LLM对图中配色方案进行分析，仅返回RGB数组分组，并额外判断是否为条纹印花
    const prompt = `请作为服装配色顾问，观察我提供的图片中的服装主配色与可衍生的协调配色方案，输出3-6组颜色组合，同时判断画面中的印花是否属于条纹式印花。若是条纹印花，请额外给出“最小印花样式”，即单次重复单元内每个色块的RGB颜色与大致宽度（px），用数组表示，例如: [{ "color": {"r":0,"g":0,"b":0}, "widthPx": 50 }, { "color": {"r":255,"g":255,"b":255}, "widthPx": 50 } ]。仅返回JSON，格式：{ "groups": [ { "colors": [ {"r":0-255,"g":0-255,"b":0-255}, ... ] } , ... ], "isStripePattern": true|false, "stripePatternUnit": [ { "color": {"r":0-255,"g":0-255,"b":0-255}, "widthPx": number }, ... ] }，不要返回多余说明文字。若无法确定条纹特征或宽度，请根据视觉倾向返回最接近的判断；若无法给出条纹描述，可返回空数组。`;
    form.append("prompt", prompt);

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/llm/poloapi/chat_form`,
      { method: "POST", headers: this.getFormHeaders(), body: form },
      LLM_IMAGE_ANALYSIS_TIMEOUT_MS,
    );
    const data = await res.json().catch(() => null);
    const rawText = (data as { text?: string } | null)?.text ?? "";
    if (rawText) {
      const parsed = extractJsonPayload<PaletteResponse>(rawText)
      return normalizePaletteResponse(parsed)
    }
    if (typeof data === "string") {
      const parsed = extractJsonPayload<PaletteResponse>(data)
      return normalizePaletteResponse(parsed)
    }
    return normalizePaletteResponse(data);
  }

  async requestPlaidPalettes(file: File): Promise<PaletteResponse> {
    const form = new FormData();
    form.append("files", file, file.name);
    const prompt = `你是一名高级服装图案分析师。请对我提供的图片进行格子（plaid / tartan / check）结构识别：1）分析整体配色，输出3-6组协调配色，每组只包含RGB对象数组；2）判断是否为格子风格（若存在交叉条纹形成方格则为true），尽量不要误判；3）若是格子，请返回最小重复单元的条纹描述，包含每条横向/纵向色带的RGB与像素宽度（px），用于还原水平与垂直条纹；若无法可靠估算，请返回空数组但仍保持JSON格式。仅返回JSON：{ "groups": [ { "colors": [ {"r":0-255,"g":0-255,"b":0-255}, ... ] } , ... ], "isStripePattern": true|false, "stripePatternUnit": [ { "color": {"r":0-255,"g":0-255,"b":0-255}, "widthPx": number }, ... ] }，不要包含任何解释文字。`;
    form.append("prompt", prompt);

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/llm/poloapi/chat_form`,
      { method: "POST", headers: this.getFormHeaders(), body: form },
      LLM_IMAGE_ANALYSIS_TIMEOUT_MS,
    );
    const data = await res.json().catch(() => null);
    const rawText = (data as { text?: string } | null)?.text ?? "";
    if (rawText) {
      const parsed = extractJsonPayload<PaletteResponse>(rawText)
      return normalizePaletteResponse(parsed)
    }
    if (typeof data === "string") {
      const parsed = extractJsonPayload<PaletteResponse>(data)
      return normalizePaletteResponse(parsed)
    }
    return normalizePaletteResponse(data);
  }

  async submitVariantOverlay(imageDataUrl: string): Promise<ExtractResponse> {
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const extension =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/jpeg"
          ? "jpg"
          : "png";
    const fileName = `variant-overlay-${Date.now()}.${extension}`;
    const file = new File([blob], fileName, { type: blob.type || "image/png" });

    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/variant_overlay`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "variant_overlay", action: "created" });
    return data;
  }

  async submitSuperResolution(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/super_resolution`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "super_resolution", action: "created" });
    return data;
  }

  async submitImageLayer(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/complete_image_layer`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "image_layer", action: "created" });
    return data;
  }

  async submitRemoveBackground(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/remove_background`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "remove_background", action: "created" });
    return data;
  }

  async submitSvgVectorization(file: File): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "image");

    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/svg_vectorization`,
      { method: "POST", headers: this.getFormHeaders(), body: form }
    );
    const data = await res.json();
    notifyTaskActivity({ source: "svg_vectorization", action: "created" });
    return data;
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/${taskId}`,
      { headers: this.getHeaders() }
    );
    return res.json();
  }

  async completeTask(taskId: string): Promise<{ outputs: string[] }> {
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
        const normalised = relative.replace(/\\/g, "/");
        outputs.push(`${this.baseUrl}/proxy/static/images/${normalised}`);
      }
    } else if (Array.isArray(data.outputs)) {
      for (const item of data.outputs) {
        if (!item) continue;
        if (typeof item === "string") {
          outputs.push(item);
        } else if (typeof item === "object" && "localPath" in item && typeof item.localPath === "string") {
          const relative = item.localPath.replace(/^\.?[\\\/]?output[\\\/]/i, "");
          outputs.push(`${this.baseUrl}/proxy/static/images/${relative.replace(/\\/g, "/")}`);
        } else if (typeof item === "object" && "fileUrl" in item && typeof item.fileUrl === "string") {
          outputs.push(item.fileUrl);
        }
      }
    }

    return { outputs };
  }

  async getTaskHistory(page: number = 1, taskType?: string, limit?: number): Promise<TaskHistoryItem[]> {
    const qs = new URLSearchParams({ page: String(page) });
    if (taskType) qs.set('task_type', taskType);
    if (limit) qs.set('limit', String(limit));
    const res = await this.makeRequest(
      `${this.baseUrl}/proxy/tasks/history?${qs.toString()}`,
      { method: "GET", headers: this.getHeaders() }
    );
    return res.json();
  }

  async attachTasksToProject(projectId: string, taskIds: string[]): Promise<void> {
    const ids = taskIds.filter(Boolean)
    if (!projectId || ids.length === 0) return
    await this.makeRequest(
      `${this.baseUrl}/proxy/projects/${encodeURIComponent(projectId)}/tasks`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ task_ids: ids }),
      }
    )
  }
}

export const extractApiClient = new ExtractApiClient();
