import type { AdminComment, AdminCommentQuery, AdminContent, AdminContentQuery, AdminOverview, AdminSessionList, AdminStats, AnalyticsViews, AnalyticsViewsQuery, AnchorQuery, AuditEventCollection, AuditQuery, AuthMeResponse, ChainAnchor, ChainBlockDetail, ChainBlockSummary, ChainInfo, ChainPublicKey, ChangePasswordInput, Collection, Comment, CommentQuery, Content, ContentDetail, ContentDetailQuery, ContentInput, ContentQuery, CreateCommentInput, GitHubExchangeInput, GitHubExchangeResponse, HealthStatus, HomeTimeline, HomeTimelineQuery, LikeSummary, LoginInput, LoginResponse, Media, MediaQuery, MediaReferenceList, PresenceStatus, Profile, ProfileInput, SiteComposition, SiteConfig, SiteConfigInput, Stats, SubmitAnchorInput, SubmitAnchorResponse, SystemStatus, TagQuery, TagSummary, ThoughtConfig, ThoughtConfigInput, UpdateCommentInput, UpdateContentInput, VerifyResponse, WritingConfig, WritingConfigInput } from "@manifold/contracts";

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

export interface ManifoldClientOptions { baseUrl: string; fetch?: typeof globalThis.fetch; token?: string; browserVisitorCookie?: boolean }

const VISITOR_COOKIE = "manifold-visitor";

function readVisitorCookie(): string {
	if (typeof document === "undefined") return "";
	const match = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VISITOR_COOKIE}=`));
	if (!match) return "";
	return decodeURIComponent(match.slice(VISITOR_COOKIE.length + 1));
}

export class ManifoldClient {
	private readonly fetcher: typeof globalThis.fetch;
	private readonly baseUrl: string;
	private readonly browserVisitorCookie: boolean;
	private token?: string;

	constructor(options: ManifoldClientOptions) { this.baseUrl = options.baseUrl.replace(/\/$/, ""); this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.token = options.token; this.browserVisitorCookie = options.browserVisitorCookie ?? false; }
	setToken(token?: string) { this.token = token; }
	authMe() { return this.request<AuthMeResponse>("/api/v1/auth/me"); }
	exchangeGitHub(input: GitHubExchangeInput) { return this.request<GitHubExchangeResponse>("/api/v1/auth/github/exchange", { method: "POST", body: input }); }
	health() { return this.request<HealthStatus>("/healthz"); }
	profile() { return this.request<Profile>("/api/v1/profile"); }
	site() { return this.request<SiteComposition>("/api/v1/site"); }
	homeTimeline(query?: HomeTimelineQuery) { return this.request<HomeTimeline>(this.withQuery("/api/v1/home/timeline", query, ["limit"])); }
	content(query?: ContentQuery) { return this.request<Collection<Content>>(this.withQuery("/api/v1/content", query, ["kind", "tag", "q", "page", "pageSize", "sort", "aiAssisted"])); }
	tags(query?: TagQuery) { return this.request<Collection<TagSummary>>(this.withQuery("/api/v1/tags", query, ["kind"])); }
	contentBySlug(slug: string, query?: ContentDetailQuery, visitorId?: string) {
		const headers = visitorId ? { "X-Visitor-ID": visitorId } : undefined;
		const url = this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}`, query ? { trackView: query.trackView === false ? false : undefined, referrer: query.referrer } : undefined, ["trackView", "referrer"]);
		return this.request<ContentDetail>(url, { headers });
	}
	stats() { return this.request<Stats>("/api/v1/stats"); }
	presence(visitorId: string) { return this.request<PresenceStatus>("/api/v1/presence", { method: "POST", headers: { "X-Visitor-ID": visitorId } }); }
	comments(slug: string, query?: CommentQuery) { return this.request<Collection<Comment>>(this.withQuery(`/api/v1/content/${encodeURIComponent(slug)}/comments`, query, ["page", "pageSize", "q"])); }
	createComment(slug: string, input: CreateCommentInput) { return this.request<Comment>(`/api/v1/content/${encodeURIComponent(slug)}/comments`, { method: "POST", body: input }); }
	likes(slug: string, visitorId?: string) { return this.request<LikeSummary>(`/api/v1/content/${encodeURIComponent(slug)}/likes`, { headers: visitorId ? { "X-Visitor-ID": visitorId } : undefined }); }
	setLike(slug: string, visitorId: string, enabled: boolean) { return this.request<LikeSummary>(`/api/v1/content/${encodeURIComponent(slug)}/likes`, { method: enabled ? "PUT" : "DELETE", headers: { "X-Visitor-ID": visitorId } }); }
	login(input: LoginInput) { return this.request<LoginResponse>("/api/v1/admin/session", { method: "POST", body: input }); }
	logoutSession() { return this.request<void>("/api/v1/admin/session/logout", { method: "POST" }); }
	logoutSessionById(id: string) { return this.request<void>(`/api/v1/admin/session/${this.path(id)}/logout`, { method: "POST" }); }
	logoutAllSessions() { return this.request<void>("/api/v1/admin/session/logout-all", { method: "POST" }); }
	changePassword(input: ChangePasswordInput) { return this.request<void>("/api/v1/admin/password", { method: "POST", body: input }); }
	adminSessions() { return this.request<AdminSessionList>("/api/v1/admin/session/list"); }
	adminStats() { return this.request<AdminStats>("/api/v1/admin/stats"); }
	adminProfile() { return this.request<Profile>("/api/v1/admin/profile"); }
	updateProfile(input: ProfileInput) { return this.request<Profile>("/api/v1/admin/profile", { method: "PUT", body: input }); }
	adminSite() { return this.request<SiteConfig>("/api/v1/admin/site"); }
	updateSite(input: SiteConfigInput) { return this.request<SiteConfig>("/api/v1/admin/site", { method: "PUT", body: input }); }
	adminThoughtConfig() { return this.request<ThoughtConfig>("/api/v1/admin/thoughts/config"); }
	updateThoughtConfig(input: ThoughtConfigInput) { return this.request<ThoughtConfig>("/api/v1/admin/thoughts/config", { method: "PUT", body: input }); }
	adminWritingConfig() { return this.request<WritingConfig>("/api/v1/admin/writings/config"); }
	updateWritingConfig(input: WritingConfigInput) { return this.request<WritingConfig>("/api/v1/admin/writings/config", { method: "PUT", body: input }); }
	adminContent(query?: AdminContentQuery) { return this.request<Collection<AdminContent>>(this.withQuery("/api/v1/admin/content", query, ["kind", "tag", "q", "page", "pageSize", "sort", "aiAssisted", "status", "pinned"])); }
	adminContentItem(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${this.path(id)}`); }
	createContent(input: ContentInput) { return this.request<AdminContent>("/api/v1/admin/content", { method: "POST", body: input }); }
	updateContent(id: string, input: UpdateContentInput) { return this.request<AdminContent>(`/api/v1/admin/content/${this.path(id)}`, { method: "PUT", body: input }); }
	publishContent(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${this.path(id)}/publish`, { method: "POST" }); }
	unpublishContent(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${this.path(id)}/unpublish`, { method: "POST" }); }
	deleteContent(id: string) { return this.request<void>(`/api/v1/admin/content/${this.path(id)}`, { method: "DELETE" }); }
	restoreContent(id: string) { return this.request<AdminContent>(`/api/v1/admin/content/${this.path(id)}/restore`, { method: "POST" }); }
	adminComments(query?: AdminCommentQuery) { return this.request<Collection<AdminComment>>(this.withQuery("/api/v1/admin/comments", query, ["contentId", "q", "page", "pageSize", "focus"])); }
	adminCreateComment(contentId: string, input: CreateCommentInput) { return this.request<Comment>(`/api/v1/admin/content/${this.path(contentId)}/comments`, { method: "POST", body: input }); }
	deleteComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${this.path(id)}`, { method: "DELETE" }); }
	restoreComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${this.path(id)}/restore`, { method: "POST" }); }
	hideComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${this.path(id)}/hide`, { method: "POST" }); }
	unhideComment(id: string) { return this.request<void>(`/api/v1/admin/comments/${this.path(id)}/unhide`, { method: "POST" }); }
	updateCommentAuthor(id: string, input: UpdateCommentInput) { return this.request<void>(`/api/v1/admin/comments/${this.path(id)}`, { method: "PUT", body: input }); }
	adminOverview() { return this.request<AdminOverview>("/api/v1/admin/overview"); }
	adminAnalyticsViews(query?: AnalyticsViewsQuery) { return this.request<AnalyticsViews>(this.withQuery("/api/v1/admin/analytics/views", query, ["days"])); }
	adminSystem() { return this.request<SystemStatus>("/api/v1/admin/system"); }
	adminAudit(query?: AuditQuery) { return this.request<AuditEventCollection>(this.withQuery("/api/v1/admin/audit", query, ["page", "pageSize", "q"])); }
	listMedia(query?: MediaQuery) { return this.request<Collection<Media>>(this.withQuery("/api/v1/admin/media", query, ["page", "pageSize", "q"])); }
	uploadMedia(blob: Blob, filename: string) { return this.request<Media>(this.withQuery("/api/v1/admin/media", { filename }, ["filename"]), { method: "POST", body: blob }); }
	deleteMedia(id: string) { return this.request<void>(`/api/v1/admin/media/${this.path(id)}`, { method: "DELETE" }); }
	mediaReferences(id: string) { return this.request<MediaReferenceList>(`/api/v1/admin/media/${this.path(id)}/references`); }
	chain() { return this.request<ChainInfo>("/api/v1/chain"); }
	chainAnchors(query?: AnchorQuery) { return this.request<Collection<ChainAnchor>>(this.withQuery("/api/v1/chain/anchors", query, ["source", "ref", "page", "pageSize"])); }
	chainAnchor(id: string) { return this.request<ChainAnchor>(`/api/v1/chain/anchors/${this.path(id)}`); }
	submitAnchor(input: SubmitAnchorInput) { return this.request<SubmitAnchorResponse>("/api/v1/chain/anchors", { method: "POST", body: input }); }
	chainBlocks(query?: { page?: number; pageSize?: number }) { return this.request<Collection<ChainBlockSummary>>(this.withQuery("/api/v1/chain/blocks", query, ["page", "pageSize"])); }
	chainBlock(id: string) { return this.request<ChainBlockDetail>(`/api/v1/chain/blocks/${this.path(id)}`); }
	verifyByHash(hash: string) { return this.request<VerifyResponse>(this.withQuery("/api/v1/chain/verify", { hash }, ["hash"])); }
	verifyPayload(payload: string) { return this.request<VerifyResponse>("/api/v1/chain/verify", { method: "POST", body: { payload } }); }
	verifyContent(slug: string) { return this.request<VerifyResponse>(`/api/v1/chain/verify/content/${this.path(slug)}`); }
	verifyComment(id: string) { return this.request<VerifyResponse>(`/api/v1/chain/verify/comment/${this.path(id)}`); }
	chainKeys() { return this.request<{ keys: ChainPublicKey[] }>("/api/v1/chain/keys"); }
	adminSubmitAnchor(input: SubmitAnchorInput) { return this.request<SubmitAnchorResponse>("/api/v1/admin/chain/anchors", { method: "POST", body: input }); }

	private path(segment: string) { return encodeURIComponent(segment); }

	private withQuery(path: string, query: object | undefined, allowedKeys: readonly string[]) {
		if (!query) return path;
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (!allowedKeys.includes(key)) continue;
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
		else if (this.browserVisitorCookie) {
			const visitor = readVisitorCookie();
			if (visitor) headers.set("Authorization", `Bearer ${visitor}`);
		}
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
