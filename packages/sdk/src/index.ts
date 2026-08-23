import type { AdminContentQuery, AdminStats, Collection, Comment, CommentQuery, Content, ContentDetail, ContentInput, ContentQuery, CreateCommentInput, HealthStatus, LoginInput, LoginResponse, NowStatus, Profile, Project, SiteComposition, Stats, UpdateContentInput } from "@manifold/contracts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;
	readonly requestId?: string;

	constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
		this.requestId = requestId;
	}
}

export interface ManifoldClientOptions { baseUrl: string; fetch?: typeof globalThis.fetch; token?: string }

export class ManifoldClient {
	private readonly fetcher: typeof globalThis.fetch;
	private readonly baseUrl: string;
	private token?: string;

	constructor(options: ManifoldClientOptions) { this.baseUrl = options.baseUrl.replace(/\/$/, ""); this.fetcher = options.fetch ?? globalThis.fetch; this.token = options.token; }
	setToken(token?: string) { this.token = token; }
	health() { return this.request<HealthStatus>("/healthz"); }
	profile() { return this.request<Profile>("/api/v1/profile"); }
	site() { return this.request<SiteComposition>("/api/v1/site"); }
	feed(query?: ContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/feed", query)); }
	content(query?: ContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/content", query)); }
	contentBySlug(slug: string) { return this.request<ContentDetail>(`/api/v1/content/${encodeURIComponent(slug)}`); }
	projects() { return this.request<Collection<Project>>("/api/v1/projects"); }
	now() { return this.request<NowStatus>("/api/v1/now"); }
	stats() { return this.request<Stats>("/api/v1/stats"); }
	comments(slug: string, query?: CommentQuery) { return this.request<Collection<Comment>>(this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}/comments`, query)); }
	createComment(slug: string, input: CreateCommentInput) { return this.request<Comment>(`/api/v1/content/${encodeURIComponent(slug)}/comments`, { method: "POST", body: input }); }
	login(input: LoginInput) { return this.request<LoginResponse>("/api/v1/admin/session", { method: "POST", body: input }); }
	adminStats() { return this.request<AdminStats>("/api/v1/admin/stats"); }
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

	private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
		const headers = new Headers({ Accept: "application/json" });
		if (options.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
		const response = await this.fetcher(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
		if (!response.ok) {
			const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined;
			throw new ApiError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Request failed with status ${response.status}`, body?.error?.details, body?.error?.requestId);
		}
		if (response.status === 204) return undefined as T;
		return response.json() as Promise<T>;
	}
}
