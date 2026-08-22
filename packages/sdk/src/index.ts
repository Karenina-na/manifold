import type { EntriesResponse, HealthStatus, NowStatus, Profile } from "@manifold/contracts";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}
export interface ManifoldClientOptions { baseUrl: string; fetch?: typeof globalThis.fetch; token?: string }
export class ManifoldClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly token?: string;
  constructor(options: ManifoldClientOptions) { this.baseUrl = options.baseUrl.replace(/\/$/, ""); this.fetcher = options.fetch ?? globalThis.fetch; this.token = options.token; }
  health(): Promise<HealthStatus> { return this.request("/healthz"); }
  profile(): Promise<Profile> { return this.request("/api/v1/profile"); }
  entries(): Promise<EntriesResponse> { return this.request("/api/v1/entries"); }
  now(): Promise<NowStatus> { return this.request("/api/v1/now"); }
  private async request<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined });
    if (!response.ok) { const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined; throw new ApiError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Request failed with status ${response.status}`); }
    return response.json() as Promise<T>;
  }
}
