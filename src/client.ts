/**
 * SpaceVenturoClient
 * HTTP client to interact with Space Venturo API using Bearer Token
 * - Logs in on first request if auth token is missing or if encountering 401
 */

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
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined | null>,
    service: "space" | "timebox" = "space"
  ): Promise<T> {
    await this.ensureAuth();

    const base = service === "timebox" ? this.timeboxBaseUrl : this.baseUrl;
    let url = `${base}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          params.set(k, String(v));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const doRequest = async (token: string): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      return fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    let res = await doRequest(this.accessToken!);

    // 401 Unauthorized → re-login once and retry
    if (res.status === 401) {
      this.accessToken = null; // Clear old token
      await this.login();
      res = await doRequest(this.accessToken!);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    // 204 No Content
    if (res.status === 204) return null as T;

    return res.json() as Promise<T>;
  }

  // Convenience methods
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined | null>, service: "space" | "timebox" = "space"): Promise<T> {
    return this.request<T>("GET", path, undefined, query, service);
  }

  post<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<T> {
    return this.request<T>("POST", path, body, undefined, service);
  }

  put<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<T> {
    return this.request<T>("PUT", path, body, undefined, service);
  }

  delete<T>(path: string, service: "space" | "timebox" = "space"): Promise<T> {
    return this.request<T>("DELETE", path, undefined, undefined, service);
  }

  patch<T>(path: string, body?: unknown, service: "space" | "timebox" = "space"): Promise<T> {
    return this.request<T>("PATCH", path, body, undefined, service);
  }
}
