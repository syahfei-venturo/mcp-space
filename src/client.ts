/**
 * SpaceVenturoClient
 * HTTP client to interact with Space Venturo API using Bearer Token
 * - Logs in on first request if auth token is missing or if encountering 401
 */

export interface ApiResponse<T> {
  status_code: number;
  data: T;
  message: string;
  settings: unknown[];
}

interface LoginResponse {
  status_code: number;
  data: {
    access_token: string;
    token_type: string;
    user: {
      id: number;
      nama: string;
      email: string;
      jabatan: string;
      humanis_id?: number;
      akses?: string;
      role?: {
        id: number;
        nama: string;
        akses: string;
      };
    };
  };
  message: string;
  settings: unknown[];
}

export class SpaceVenturoClient {
  private baseUrl: string;
  private timeboxBaseUrl: string;
  private email: string;
  private password: string;
  private accessToken: string | null = null;
  public defaultProjectId: number | undefined;
  public userId: number | undefined;
  public humanisId: number | undefined;
  public aksesNama: string | undefined;

  constructor() {
    this.baseUrl = (process.env.SPACE_API_URL ?? "https://space-api.venturo.id").replace(/\/$/, "");
    this.timeboxBaseUrl = (process.env.TIMEBOX_API_URL ?? "https://timebox-api.venturo.id").replace(/\/$/, "");
    this.email = process.env.SPACE_API_EMAIL ?? "";
    this.password = process.env.SPACE_API_PASSWORD ?? "";
    this.defaultProjectId = process.env.SPACE_API_DEFAULT_PROJECT_ID 
      ? parseInt(process.env.SPACE_API_DEFAULT_PROJECT_ID, 10) 
      : undefined;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async login(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error("Autentikasi Gagal: SPACE_API_EMAIL dan SPACE_API_PASSWORD belum di-setting di file .env. Anda (AI) harus meminta User untuk mengatur kredensial ini terlebih dahulu.");
    }

    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status} ${await res.text()}`);
    }

    const resJson = (await res.json()) as LoginResponse;
    if (resJson.status_code !== 200 || !resJson.data || !resJson.data.access_token) {
       throw new Error(`Login failed, unexpected response structure: ${JSON.stringify(resJson)}`);
    }

    this.accessToken = resJson.data.access_token;
    this.userId = resJson.data.user?.id;
    this.humanisId = resJson.data.user?.humanis_id;
    this.aksesNama = resJson.data.user?.akses ?? resJson.data.user?.role?.nama;
  }

  public async ensureAuth(): Promise<void> {
    if (!this.accessToken) {
      await this.login();
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async request<T>(
    path: string,
    options: RequestInit = {},
    service: "space" | "timebox" = "space",
    timeoutMs: number = 60000 // Default 60 seconds
  ): Promise<ApiResponse<T>> {
    await this.ensureAuth();

    const baseUrl = service === "timebox" ? this.timeboxBaseUrl : this.baseUrl;
    const url = `${baseUrl}${path}`;
    
    // Log URL to stderr for transparency
    console.error(`[MCP] Requesting ${options.method || 'GET'} ${url}`);

    const headers = {
      ...options.headers,
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    } as Record<string, string>;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        clearTimeout(timeoutId);
        // Token expired? Try re-login once.
        this.accessToken = null;
        await this.login();
        return this.request<T>(path, options, service, timeoutMs);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText.substring(0, 500)}`);
      }

      if (response.status === 204) {
        return { status_code: 204, data: null as any, message: "No Content", settings: [] };
      }

      const data = (await response.json()) as ApiResponse<T>;
      return data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined | null> = {},
    service: "space" | "timebox" = "space"
  ): Promise<ApiResponse<T>> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;
    return this.request<T>(fullPath, { method: "GET" }, service);
  }

  async post<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, service);
  }

  async put<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }, service);
  }

  async patch<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }, service);
  }

  async delete<T>(path: string, service: "space" | "timebox" = "space"): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "DELETE" }, service);
  }
}
