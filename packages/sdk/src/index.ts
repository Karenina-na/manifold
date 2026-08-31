import type { AdminContent, AdminContentQuery, AdminOverview, AdminStats, AnalyticsViews, AnalyticsViewsQuery, AuditEventCollection, AuditQuery, Collection, Comment, CommentQuery, Content, ContentDetail, ContentInput, ContentQuery, CreateCommentInput, HealthStatus, LikeSummary, LoginInput, LoginResponse, Media, MediaQuery, PresenceStatus, Profile, ProfileInput, SiteComposition, SiteConfig, SiteConfigInput, Stats, SystemStatus, TagQuery, TagSummary, ThoughtArchive, ThoughtArchiveQuery, ThoughtConfig, ThoughtConfigInput, UpdateContentInput } from "@manifold/contracts";

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
	thoughts(query?: ThoughtArchiveQuery) { return this.request<ThoughtArchive>(this.withQuery("/api/v1/thoughts", query)); }
	tags(query?: TagQuery) { return this.request<Collection<TagSummary>>(this.withQuery("/api/v1/tags", query)); }
	contentBySlug(slug: string, options?: { trackView?: boolean; referrer?: string; visitorId?: string }) {
		const headers = options?.visitorId ? { "X-Visitor-ID": options.visitorId } : undefined;
		const url = this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}`, options ? { trackView: options.trackView === false ? false : undefined, referrer: options.referrer } : undefined);
		return this.request<ContentDetail>(url, { headers });
	}
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
	adminThoughtConfig() { return this.request<ThoughtConfig>("/api/v1/admin/thoughts/config"); }
	updateThoughtConfig(input: ThoughtConfigInput) { return this.request<ThoughtConfig>("/api/v1/admin/thoughts/config", { method: "PATCH", body: input }); }
	adminContent(query?: AdminContentQuery) { return this.request<Collection<AdminContent>>(this.withQuery("/api/v1/admin/content", query)); }
	adminContentItem(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${encodeURIComponent(id)}`); }
	createContent(input: ContentInput) { return this.request<AdminContent>("/api/v1/admin/content", { method: "POST", body: input }); }
	updateContent(id: string, input: UpdateContentInput) { return this.request<AdminContent>(`/api/v1/admin/content/${id}`, { method: "PATCH", body: input }); }
	publishContent(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${id}/publish`, { method: "POST" }); }
	unpublishContent(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${id}/unpublish`, { method: "POST" }); }
	deleteContent(id: string) { return this.request<void>(`/api/v1/admin/content/${id}`, { method: "DELETE" }); }
	adminComments(query?: CommentQuery) { return this.request<Collection<Comment>>(this.withQuery("/api/v1/admin/comments", query)); }
	deleteComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${id}`, { method: "DELETE" }); }
	restoreComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${id}/restore`, { method: "POST" }); }
	adminOverview() { return this.request<AdminOverview>("/api/v1/admin/overview"); }
	adminAnalyticsViews(query?: AnalyticsViewsQuery) { return this.request<AnalyticsViews>(this.withQuery("/api/v1/admin/analytics/views", query)); }
	adminSystem() { return this.request<SystemStatus>("/api/v1/admin/system"); }
	adminAudit(query?: AuditQuery) { return this.request<AuditEventCollection>(this.withQuery("/api/v1/admin/audit", query)); }
	listMedia(query?: MediaQuery) { return this.request<Collection<Media>>(this.withQuery("/api/v1/admin/media", query)); }
	uploadMedia(blob: Blob, filename: string) { return this.request<Media>(this.withQuery("/api/v1/admin/media", { filename }), { method: "POST", body: blob }); }
	deleteMedia(id: string) { return this.request<void>(`/api/v1/admin/media/${encodeURIComponent(id)}`, { method: "DELETE" }); }

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
		if (options.body instanceof Blob) {
			// Binary uploads pass the Blob through untouched; Core sniffs the
			// content type server-side, so only forward it when the Blob has one.
			if (options.body.type) headers.set("Content-Type", options.body.type);
		} else if (options.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
		for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
		const body = options.body === undefined ? undefined : options.body instanceof Blob ? options.body : JSON.stringify(options.body);
		const response = await this.fetcher(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body });
		if (!response.ok) {
			const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; details?: unknown; requestId?: string; traceId?: string } } | undefined;
			throw new ApiError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Request failed with status ${response.status}`, body?.error?.details, body?.error?.requestId, body?.error?.traceId ?? response.headers.get("X-Trace-ID") ?? undefined);
		}
		if (response.status === 204) return undefined as T;
		return response.json() as Promise<T>;
	}
}
