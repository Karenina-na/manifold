import type { AdminContentQuery, AdminStats, Collection, Comment, CommentQuery, Content, ContentDetail, ContentInput, ContentQuery, CreateCommentInput, HealthStatus, LikeSummary, LoginInput, LoginResponse, NowStatus, PresenceStatus, Profile, ProfileInput, SiteComposition, SiteConfig, SiteConfigInput, Stats, UpdateContentInput } from "@manifold/contracts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;
	readonly requestId?: string;
	readonly traceId?: string;

	constructor(status: number, code: string, message: string, details?: unknown, requestId?: string, traceId?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
		this.requestId = requestId;
		this.traceId = traceId;
	}
}

export function createTraceId() {
	const uuid = globalThis.crypto?.randomUUID?.();
	return `trace_${uuid?.replaceAll("-", "") ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}`;
}

export interface ManifoldClientOptions { baseUrl: string; fetch?: typeof globalThis.fetch; token?: string }

export class ManifoldClient {
	private readonly fetcher: typeof globalThis.fetch;
	private readonly baseUrl: string;
	private token?: string;

	constructor(options: ManifoldClientOptions) { this.baseUrl = options.baseUrl.replace(/\/$/, ""); this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.token = options.token; }
	setToken(token?: string) { this.token = token; }
	health() { return this.request<HealthStatus>("/healthz"); }
	profile() { return this.request<Profile>("/api/v1/profile"); }
	site() { return this.request<SiteComposition>("/api/v1/site"); }
	feed(query?: ContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/feed", query)); }
	content(query?: ContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/content", query)); }
	contentBySlug(slug: string, options?: { trackView?: boolean }) { return this.request<ContentDetail>(this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}`, options?.trackView === false ? { trackView: false } : undefined)); }
	now() { return this.request<NowStatus>("/api/v1/now"); }
	stats() { return this.request<Stats>("/api/v1/stats"); }
	presence(visitorId: string) { return this.request<PresenceStatus>("/api/v1/presence", { method: "POST", headers: { "X-Visitor-ID": visitorId } }); }
	comments(slug: string, query?: CommentQuery) { return this.request<Collection<Comment>>(this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}/comments`, query)); }
	createComment(slug: string, input: CreateCommentInput) { return this.request<Comment>(`/api/v1/content/${encodeURIComponent(slug)}/comments`, { method: "POST", body: input }); }
	likes(slug: string, visitorId?: string) { return this.request<LikeSummary>(`/api/v1/content/${encodeURIComponent(slug)}/likes`, { headers: visitorId ? { "X-Visitor-ID": visitorId } : undefined }); }
	setLike(slug: string, visitorId: string, enabled: boolean) { return this.request<LikeSummary>(`/api/v1/content/${encodeURIComponent(slug)}/likes`, { method: enabled ? "PUT" : "DELETE", headers: { "X-Visitor-ID": visitorId } }); }
	login(input: LoginInput) { return this.request<LoginResponse>("/api/v1/admin/session", { method: "POST", body: input }); }
	adminStats() { return this.request<AdminStats>("/api/v1/admin/stats"); }
	adminProfile() { return this.request<Profile>("/api/v1/admin/profile"); }
	updateProfile(input: ProfileInput) { return this.request<Profile>("/api/v1/admin/profile", { method: "PATCH", body: input }); }
	adminSite() { return this.request<SiteConfig>("/api/v1/admin/site"); }
	updateSite(input: SiteConfigInput) { return this.request<SiteConfig>("/api/v1/admin/site", { method: "PATCH", body: input }); }
	adminContent(query?: AdminContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/admin/content", query)); }
	createContent(input: ContentInput) { return this.request<Content>("/api/v1/admin/content", { method: "POST", body: input }); }
	updateContent(id: string, input: UpdateContentInput) { return this.request<Content>(`/api/v1/admin/content/${id}`, { method: "PATCH", body: input }); }
	publishContent(id: string) { return this.request<Content>(`/api/v1/admin/content/${id}/publish`, { method: "POST" }); }
	unpublishContent(id: string) { return this.request<Content>(`/api/v1/admin/content/${id}/unpublish`, { method: "POST" }); }
	deleteContent(id: string) { return this.request<void>(`/api/v1/admin/content/${id}`, { method: "DELETE" }); }
	adminComments(status = "PENDING") { return this.request<Collection<Comment>>(this.withQuery("/api/v1/admin/comments", { status })); }
	approveComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${id}/approve`, { method: "POST" }); }
	rejectComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${id}/reject`, { method: "POST" }); }
	updateNow(input: NowStatus) { return this.request<NowStatus>("/api/v1/admin/now", { method: "PUT", body: input }); }

	private withQuery(path: string, query?: object) {
		if (!query) return path;
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined || value === null || value === "") continue;
			params.set(key, Array.isArray(value) ? value.join(",") : String(value));
		}
		const encoded = params.toString();
		return encoded ? `${path}?${encoded}` : path;
	}

	private async request<T>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
		const headers = new Headers({ Accept: "application/json" });
		headers.set("X-Trace-ID", createTraceId());
		if (options.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
		for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
		const response = await this.fetcher(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
		if (!response.ok) {
			const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; details?: unknown; requestId?: string; traceId?: string } } | undefined;
			throw new ApiError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Request failed with status ${response.status}`, body?.error?.details, body?.error?.requestId, body?.error?.traceId ?? response.headers.get("X-Trace-ID") ?? undefined);
		}
		if (response.status === 204) return undefined as T;
		return response.json() as Promise<T>;
	}
}
