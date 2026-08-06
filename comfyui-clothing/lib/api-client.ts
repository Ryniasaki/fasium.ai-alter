import { fetchWithTimeout } from "./fetch-with-timeout"

const API_BASE_URL = "/api"

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface RegisterRequest {
  username: string
  email?: string | null
  phone: string
  password: string
  tenant_id: number
  captchaToken: string
  captchaCode: string
  inviteCode?: string
}

export interface RegisterResponse {
  id: number
  username: string
  email: string | null
  tenant_id: number
  is_active: boolean
  role?: "manager" | "employee"
  manager_username?: string | null
  max_active_employees?: number
  credit?: number
  group?: number
}

export interface EmployeeAccount {
  id: number
  username: string
  email: string | null
  tenant_id: number
  is_active: boolean
  role: "employee"
  manager_username?: string | null
  max_active_employees?: number
  credit?: number
  group?: number
}

export interface EmployeeConsumptionItem {
  id: number
  username: string
  consumed_credit: number
}

export interface CreateEmployeeRequest {
  username: string
  password: string
  email?: string | null
  is_active?: boolean
}

export interface ApiError {
  detail?: string
}

export interface ApiErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown
    request_id?: string
    retryable?: boolean
    timestamp?: string
  }
}

export class ApiRequestError extends Error {
  public readonly code?: string
  public readonly status: number
  public readonly requestId?: string
  public readonly retryable?: boolean
  public readonly details?: unknown

  constructor(params: {
    message: string
    status: number
    code?: string
    requestId?: string
    retryable?: boolean
    details?: unknown
  }) {
    super(params.message)
    this.name = "ApiRequestError"
    this.status = params.status
    this.code = params.code
    this.requestId = params.requestId
    this.retryable = params.retryable
    this.details = params.details
  }
}

type RequestOptions = RequestInit & {
  redirectOnUnauthorized?: boolean
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const defaultHeaders = {
      "Content-Type": "application/json",
    }

    const config: RequestInit = {
      ...options,
      credentials: "include",
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    }

    try {
      const response = await fetchWithTimeout(url, config)

      if (!response.ok) {
        if (response.status === 401) {
          if (options.redirectOnUnauthorized !== false) {
            this.handleUnauthorized()
          }
          const unauthorizedMessage = "Unauthorized"
          throw new ApiRequestError({ message: unauthorizedMessage, status: response.status, code: "UNAUTHORIZED" })
        }

        const rawError = await response.json().catch(() => null)
        const envelope = rawError as ApiErrorEnvelope | null
        const legacy = rawError as ApiError | null

        const code = envelope?.error?.code
        const message =
          envelope?.error?.message ||
          legacy?.detail ||
          `HTTP ${response.status}: ${response.statusText}`
        const requestId = envelope?.error?.request_id
        const retryable = envelope?.error?.retryable
        const details = envelope?.error?.details

        throw new ApiRequestError({
          message,
          status: response.status,
          code,
          requestId,
          retryable,
          details,
        })
      }

      return await response.json()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error("网络请求失败")
    }
  }

  private handleUnauthorized(): void {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token")
      localStorage.removeItem("auth_token")
      localStorage.removeItem("auth_user")
      window.location.href = "/"
    }
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const formData = new URLSearchParams()
    formData.append("username", credentials.username)
    formData.append("password", credentials.password)

    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
  }

  async register(userData: RegisterRequest): Promise<RegisterResponse> {
    return this.request<RegisterResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    })
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", {
      method: "POST",
      redirectOnUnauthorized: false,
    })
  }

  async getUserInfo(token?: string): Promise<any> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request("/auth/me", {
      headers,
      redirectOnUnauthorized: false,
    })
  }

  async getTenantInfo(token?: string): Promise<any> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request("/tenants/me", { headers })
  }

  async proxyRequest(endpoint: string, token: string, options: RequestInit = {}): Promise<any> {
    return this.request(`/api${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async listEmployees(token?: string): Promise<{ manager: any; employees: EmployeeAccount[] }> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request("/auth/employees", {
      method: "GET",
      headers,
      redirectOnUnauthorized: false,
    })
  }

  async getEmployeeConsumption(
    token?: string,
  ): Promise<{ total_consumed: number; items: EmployeeConsumptionItem[] }> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request("/auth/employees/consumption", {
      method: "GET",
      headers,
      redirectOnUnauthorized: false,
    })
  }

  async createEmployee(payload: CreateEmployeeRequest, token?: string): Promise<EmployeeAccount> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request("/auth/employees", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirectOnUnauthorized: false,
    })
  }

  async updateEmployeeStatus(
    username: string,
    isActive: boolean,
    token?: string,
  ): Promise<EmployeeAccount> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request(`/auth/employees/${encodeURIComponent(username)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ is_active: isActive }),
      redirectOnUnauthorized: false,
    })
  }

  async resetEmployeePassword(
    username: string,
    newPassword: string,
    token?: string,
  ): Promise<{ username: string; password: string }> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    return this.request(`/auth/employees/${encodeURIComponent(username)}/password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ new_password: newPassword }),
      redirectOnUnauthorized: false,
    })
  }
}

export const apiClient = new ApiClient()
