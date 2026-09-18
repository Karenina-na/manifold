// Manifold 跨端公共契约。修改规则见 README.md：
// contracts -> sdk -> core -> web/admin -> docs -> tests。
//
// 空值语义约定：
// - `?:` 仅表示"该视图不携带此概念"（如 body 仅详情视图、deletedAt 仅管理端）。
// - `| null` 表示"概念存在但值可空"，Core 一律输出键并以 null 表达空值。

export type ContentKind = "THOUGHT" | "ARTICLE";
export type ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED";
export type ContentSort = "newest" | "oldest" | "updated";

// Core 可返回的全部错误码，是错误码的唯一权威清单。类型由数组派生，因此两者
// 不可能互相漂移；Go 侧的 app/core/internal/apierror 保存同名常量，两边由
// test/error-codes.test.ts 强制逐项相等。客户端可以对这些值做穷尽 switch。
export const API_ERROR_CODES = [
  // 会话与鉴权
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_CREDENTIALS",
  "SESSION_UNAVAILABLE",
  "SESSIONS_UNAVAILABLE",
  "SESSION_NOT_FOUND",
  "SESSION_REVOKE_FAILED",
  "PASSWORD_CHANGE_FAILED",
  "INVALID_VISITOR_SESSION",
  "VISITOR_ID_INVALID",
  // 第三方登录
  "GITHUB_AUTH_DISABLED",
  "GITHUB_AUTH_FAILED",
  "GITHUB_PROFILE_FAILED",
  "IDENTITY_UNAVAILABLE",
  // 请求校验与限流
  "VALIDATION_ERROR",
  "INVALID_JSON",
  "INVALID_QUERY",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  // 内容
  "CONTENT_NOT_FOUND",
  "CONTENT_UNAVAILABLE",
  "CONTENT_CREATE_FAILED",
  "CONTENT_UPDATE_FAILED",
  "CONTENT_RESTORE_FAILED",
  "SLUG_TAKEN",
  "VERSION_CONFLICT",
  // 评论与反应
  "COMMENT_NOT_FOUND",
  "COMMENT_CREATE_FAILED",
  "COMMENT_UPDATE_FAILED",
  "COMMENT_DELETED",
  "COMMENT_DISABLED",
  "COMMENTS_UNAVAILABLE",
  "REPLY_TARGET_INVALID",
  "LIKES_UNAVAILABLE",
  "LIKE_UPDATE_FAILED",
  // 媒体
  "MEDIA_NOT_FOUND",
  "MEDIA_UNAVAILABLE",
  "MEDIA_DELETE_FAILED",
  "MEDIA_TOO_LARGE",
  "MEDIA_TYPE_UNSUPPORTED",
  "MEDIA_UNREADABLE",
  "MEDIA_IN_USE",
  // Profile 与站点配置
  "PROFILE_UNAVAILABLE",
  "PROFILE_UPDATE_FAILED",
  "SITE_UNAVAILABLE",
  "SITE_UPDATE_FAILED",
  "THOUGHT_CONFIG_UNAVAILABLE",
  "THOUGHT_CONFIG_UPDATE_FAILED",
  "WRITING_CONFIG_UNAVAILABLE",
  "WRITING_CONFIG_UPDATE_FAILED",
  // 管理端系统视图
  "OVERVIEW_UNAVAILABLE",
  "ANALYTICS_UNAVAILABLE",
  "AUDIT_UNAVAILABLE",
  "STATS_UNAVAILABLE",
  "SYSTEM_UNAVAILABLE",
  // Agent
  "AGENT_UNAVAILABLE",
  "AGENT_RUN_FAILED",
  "AGENT_SETTINGS_UNAVAILABLE",
  "AGENT_SETTINGS_UPDATE_FAILED",
  "AGENT_MESSAGE_NOT_FOUND",
  // 公开端聚合视图
  "PRESENCE_UNAVAILABLE",
  "TAGS_UNAVAILABLE",
  // 锚定链
  "CHAIN_UNAVAILABLE",
  "BLOCK_NOT_FOUND",
  "ANCHOR_NOT_FOUND",
  "ANCHOR_SUBMIT_FAILED",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

export interface ApiErrorBody { error: { code: ApiErrorCode; message: string; details?: unknown; requestId?: string; traceId?: string } }
export interface HealthStatus { status: "ok"; version: string; startedAt: string }

export interface ProfileSeriesItem { name: string; url: string; description: string; category: string | null }
export interface ProfileContact { label: string; url: string; handle: string | null; icon: string | null }
export interface ProfileEducationItem { institution: string; program: string; period: string }
export interface ProfileExperienceItem { organization: string; role: string; period: string }
export interface Profile {
  id: string;
  displayName: string;
  handle: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  location: string;
  organization: string;
  websiteUrl: string;
  resumeUrl: string | null;
  interests: string[];
  education: ProfileEducationItem[];
  experience: ProfileExperienceItem[];
  series: ProfileSeriesItem[];
  contacts: ProfileContact[];
  updatedAt: string;
}
export type ProfileInput = Omit<Profile, "id" | "updatedAt">

export interface ThoughtMetadata { mood: string | null; question: string | null; context: string | null; source: string | null }
export interface ArticleMetadata {
  readingMinutes: number;
  toc: Array<{ id: string; label: string; level: 2 | 3 }>;
  language: string | null;
  aiAssisted: boolean;
}

// 公开内容形状：仅 PUBLISHED 内容对公众可见，status/version 无意义，href 由 Web 端拼接。
interface BaseContent {
  id: string;
  slug: string;
  title: string | null;
  summary: string;
  excerpt: string;
  tags: string[];
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}
export type Content =
  | (BaseContent & { kind: "THOUGHT"; metadata: ThoughtMetadata })
  | (BaseContent & { kind: "ARTICLE"; metadata: ArticleMetadata })
// latestAnchor 为锚定链摘要（docs/chain.md §11）：按 contentId 的最新 content 源证书，
// 无证书时为 null；Core 一律输出该键。
export type ContentDetail = Content & { body: string; latestAnchor: AnchorSummary | null }

// 管理端内容形状：全状态视图 + 乐观锁版本 + 完整正文。
interface BaseAdminContent {
  id: string;
  status: ContentStatus;
  slug: string;
  title: string | null;
  summary: string;
  excerpt: string;
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  body: string;
}
export type AdminContent =
  | (BaseAdminContent & { kind: "THOUGHT"; metadata: ThoughtMetadata })
  | (BaseAdminContent & { kind: "ARTICLE"; metadata: ArticleMetadata })

export interface Comment {
  id: string;
  contentId: string;
  authorName: string;
  authorUrl: string | null;
  body: string;
  createdAt: string;
  replyToId: string | null;
  avatarSeed: string;
  // Core only ever writes "visitor" or the OAuth provider that vouched for the
  // commenter (comments.author_provider is NOT NULL DEFAULT 'visitor'), so the
  // field is a closed union rather than a free string.
  authorProvider: "visitor" | "github";
  authorAvatarUrl: string;
  hidden: boolean;
}
export interface AdminComment extends Comment {
  deletedAt: string | null;
  hiddenAt: string | null;
  contentTitle: string;
  contentSlug: string;
  contentKind: ContentKind;
}
export interface CreateCommentInput { authorName?: string; authorUrl?: string; body: string; replyToId?: string; avatarSeed?: string }
export interface UpdateCommentInput { authorName?: string; authorUrl?: string | null; avatarSeed?: string }
export interface CommentQuery { page?: number; pageSize?: number; q?: string }
export interface AdminCommentQuery { contentId?: string; q?: string; page?: number; pageSize?: number; focus?: string }

export interface LikeSummary { likeCount: number; viewerLiked: boolean }

export type AuthProvider = "github";
export interface GitHubExchangeInput { code: string }
export interface GitHubExchangeResponse { token: string; provider: AuthProvider; displayName: string; avatarUrl: string }
export interface AuthMeResponse { authenticated: boolean; provider?: AuthProvider; displayName?: string; avatarUrl?: string; providers: AuthProvider[] }
export interface Stats { contentCount: number; articleCount: number; thoughtCount: number; wordCount: number; updatedAt: string }
export interface PresenceStatus { activeVisitors: number; observedAt: string }
export interface AdminStats { content: Stats }

export interface AdminOverviewContent { contentCount: number; draftCount: number; articleCount: number; thoughtCount: number; wordCount: number; totalViews: number; totalLikes: number; totalComments: number; activeVisitors: number }
export interface AdminOverviewContentItem { id: string; kind: ContentKind; slug: string; title: string | null; viewCount: number; likeCount: number; commentCount: number }
export interface AdminOverviewTrendPoint { month: string; created: number; published: number }
export interface AdminOverview { content: AdminOverviewContent; trend: { monthly: AdminOverviewTrendPoint[] }; topContent: AdminOverviewContentItem[]; tags: TagSummary[] }

export interface AnalyticsViewsQuery { days?: number }
export interface AnalyticsViews { totalViews: number; uniqueVisitors: number; range: { days: number; from: string; to: string }; daily: Array<{ date: string; views: number; uniqueVisitors: number }>; referrers: Array<{ source: string; count: number }> }

export interface SystemStatus { version: string; startedAt: string; uptimeSeconds: number; database: { sizeBytes: number }; caches: { contentEntries: number }; runtime: { heapAllocBytes: number; numGoroutine: number; sysRssBytes: number }; resources: { cpuPercent: number; cpuCores: number; memTotalBytes: number; memUsedBytes: number; memUsedPercent: number; loadAvg1: number; loadAvg5: number; loadAvg15: number; diskTotalBytes: number; diskUsedBytes: number; diskUsedPercent: number }; host: { hostname: string; os: string; platform: string; kernelArch: string }; auditEventCount: number }

export interface AuditEvent { id: string; eventName: string; resourceType: string; resourceId: string; actor: string; requestId: string | null; traceId: string | null; metadataJson: string; createdAt: string }
export interface AuditEventCollection { events: AuditEvent[]; pagination: Pagination }
export interface AuditQuery { page?: number; pageSize?: number; q?: string }

export type HomepageSection = "PROFILE" | "BACKGROUND" | "RECENT_CONTENT" | "UPDATES" | "SERIES" | "CONTACT"
export interface SiteNavigationItem { label: string; href: string; external?: boolean }
export interface SiteConfig {
  title: string;
  description: string;
  footer: string;
  social: SiteNavigationItem[];
  commentsEnabled: boolean;
  navigation: SiteNavigationItem[];
  sections: HomepageSection[];
}
export type SiteConfigInput = SiteConfig
export interface SiteComposition extends SiteConfig {
  pinnedThoughts: Extract<Content, { kind: "THOUGHT" }>[];
  pinnedWritings: Extract<Content, { kind: "ARTICLE" }>[];
}

export interface HomeTimelineQuery { limit?: number }
export interface HomeTimelineItem { id: string; kind: ContentKind; slug: string; title: string | null; summary: string; publishedAt: string }
export interface HomeTimeline { data: HomeTimelineItem[]; totalItems: number; truncated: boolean }

export interface ThoughtConfig { pinnedIds: string[]; updatedAt: string }
export interface ThoughtConfigInput { pinnedIds: string[] }
export interface WritingConfig { pinnedIds: string[]; updatedAt: string }
export interface WritingConfigInput { pinnedIds: string[] }

export interface Pagination { page: number; pageSize: number; totalItems: number; totalPages: number }
export interface Collection<T> { data: T[]; pagination: Pagination }

export interface ContentQuery { kind?: ContentKind | ContentKind[]; tag?: string | string[]; q?: string; page?: number; pageSize?: number; sort?: ContentSort; aiAssisted?: boolean }
export interface AdminContentQuery extends ContentQuery { status?: ContentStatus; pinned?: boolean }
export interface ContentDetailQuery { trackView?: boolean; referrer?: string }

export interface TagQuery { kind?: ContentKind }
export interface TagSummary { name: string; count: number }
export interface Media { id: string; url: string; mime: string; size: number; filename: string; createdAt: string }
export interface MediaQuery { page?: number; pageSize?: number; q?: string }

export interface LoginInput { username: string; password: string }
export interface LoginResponse { accessToken: string; tokenType: "Bearer"; expiresIn: number; user: { username: string; role: "admin" } }
export interface ChangePasswordInput { currentPassword: string; newPassword: string }

export interface AgentRunInput { message: string }
export type AgentProvider = "openai";
export interface AgentSettings {
  provider: AgentProvider;
  model: string;
  maxToolRounds: number;
  historyLimit: number;
  compactionRecentTurns: number;
  compactionMaxOutputTokens: number;
  maxOutputTokens: number;
  openAIBaseURL: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}
export interface AgentSettingsInput {
  provider: AgentProvider;
  model: string;
  maxToolRounds: number;
  historyLimit: number;
  compactionRecentTurns: number;
  compactionMaxOutputTokens: number;
  maxOutputTokens: number;
  openAIBaseURL: string;
  /** Omit to keep the stored key, set a string to replace it, or null to clear it. */
  apiKey?: string | null;
}
export type AgentMessageRole = "user" | "assistant";
export interface AgentUsage { inputTokens: number; outputTokens: number; totalTokens: number }
export type AgentFinishReason = "stop" | "tool_calls" | "max_tokens" | "error";
export type AgentTraceStep =
  | { id: string; kind: "reasoning"; status: "running" | "complete" }
  | { id: string; kind: "tool"; name: string; input: unknown; output?: unknown; status: "running" | "complete" | "error" }
  | { id: string; kind: "error"; message: string };
export interface AgentMessageTrace { steps: AgentTraceStep[]; finishReason: AgentFinishReason; usage: AgentUsage }
export interface AgentMessage { id: string; role: AgentMessageRole; content: string; createdAt: string; trace?: AgentMessageTrace }
export interface AgentMessageList { messages: AgentMessage[] }
export interface AgentCompactionResult { compacted: boolean }
export interface AgentUndoResult { draft: string; messages: AgentMessage[] }
export type AgentStreamEvent =
  | { type: "run.started"; runId: string; messageId: string }
  | { type: "reasoning.started"; runId: string }
  | { type: "reasoning.completed"; runId: string }
  | { type: "content.delta"; delta: string }
  | { type: "tool.started"; callId: string; name: string; input: unknown }
  | { type: "tool.completed"; callId: string; name: string; output: unknown; isError: boolean }
  | { type: "run.completed"; runId: string; finishReason: AgentFinishReason; usage: AgentUsage }
  | { type: "run.error"; runId: string; code: ApiErrorCode; message: string };

export function isAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const event = value as Record<string, unknown>;
  const hasRunId = typeof event.runId === "string";
  switch (event.type) {
    case "run.started":
      return hasRunId && typeof event.messageId === "string";
    case "reasoning.started":
    case "reasoning.completed":
      return hasRunId;
    case "content.delta":
      return typeof event.delta === "string";
    case "tool.started":
      return typeof event.callId === "string" && typeof event.name === "string" && "input" in event;
    case "tool.completed":
      return typeof event.callId === "string" && typeof event.name === "string" && "output" in event && typeof event.isError === "boolean";
    case "run.completed": {
      const usage = event.usage as Record<string, unknown> | undefined;
      return hasRunId && ["stop", "tool_calls", "max_tokens", "error"].includes(String(event.finishReason)) && !!usage && typeof usage.inputTokens === "number" && typeof usage.outputTokens === "number" && typeof usage.totalTokens === "number";
    }
    case "run.error":
      return hasRunId && isApiErrorCode(event.code) && typeof event.message === "string";
    default:
      return false;
  }
}
// status excludes DELETED because the reference lookup only ever reads live
// content; expressing it as an Exclude keeps the link to ContentStatus visible
// instead of restating the two literals.
export interface MediaReference { contentId: string; kind: ContentKind; title: string | null; slug: string; status: Exclude<ContentStatus, "DELETED"> }
export interface MediaReferenceList { references: MediaReference[] }
export interface AdminSession { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; active: boolean; current: boolean }
export interface AdminSessionList { sessions: AdminSession[] }

interface BaseContentInput { slug: string; title: string | null; summary: string; body: string; tags: string[] }
export interface ThoughtMetadataInput { mood: string | null; question: string | null; context: string | null; source: string | null }
export interface ArticleMetadataInput { language: string | null; aiAssisted: boolean }
export type ContentInput =
  | (BaseContentInput & { kind: "THOUGHT"; metadata: ThoughtMetadataInput })
  | (BaseContentInput & { kind: "ARTICLE"; metadata: ArticleMetadataInput })
export type UpdateContentInput =
  | (BaseContentInput & { kind: "THOUGHT"; metadata: ThoughtMetadataInput; expectedVersion: number })
  | (BaseContentInput & { kind: "ARTICLE"; metadata: ArticleMetadataInput; expectedVersion: number })

// 锚定链契约（docs/chain.md）：证书只承诺 payload 的 SHA-256，不携带原文。
export type ChainProofMode = "sim" | "proof";
export type AnchorStatus = "pending" | "anchored";
export type AnchorSource = "content" | "comment" | "reaction" | "profile" | "site" | "media" | "auth" | "visitor" | "admin";
export type AnchorMetadata = Record<string, string | number | boolean | null>;

export interface ChainPublicKey { keyId: string; publicKey: string; createdAt: string }
// AnchorTarget is a derived, human-meaningful link for an anchor: which event
// or content a subject hash stands for, resolved by Core from live data.
export interface AnchorTarget { kind: "content" | "comment" | "media"; href: string; label: string }
export interface ChainAnchor { id: string; subjectHash: string; source: AnchorSource; subjectRef: string; label: string; metadata: AnchorMetadata; siteKeyId: string; sitePublicKey: string; siteSignature: string; createdAt: string; status: AnchorStatus; blockId: string | null; summary: string; target: AnchorTarget | null }
export interface SubmitAnchorInput { payload: string; label?: string }
export interface SubmitAnchorResponse { anchorId: string; subjectHash: string; status: "pending" }
export interface ChainBlockSummary { id: string; index: number; prevHash: string; timestamp: string; certRoot: string; nonce: number; proofMode: ChainProofMode; difficulty: number; hash: string; anchorCount: number }
export interface ChainBlockDetail extends ChainBlockSummary { certIds: string[]; anchors: ChainAnchor[] }
export interface ChainInfo { height: number; totalAnchors: number; pendingAnchors: number; proofMode: ChainProofMode; difficulty: number; genesisHash: string; tipHash: string; sitePublicKey: string }
export interface VerifyStepInput { name: string; value: string; note?: string }
export interface VerifyStepComputation { expression: string; value: string }
export interface VerifyStep { id: string; label: string; status: "passed" | "failed"; detail: string; inputs?: VerifyStepInput[]; computations?: VerifyStepComputation[]; output?: string }
export interface MerkleSibling { position: "left" | "right"; value: string }
export interface VerifyMerkleProof { leafIndex: number; leaf: string; siblings: MerkleSibling[]; root: string; matches: boolean; computations: VerifyStepComputation[] }
export interface VerifyChainContext { prev: ChainBlockSummary | null; current: ChainBlockSummary | null; next: ChainBlockSummary | null }
export interface VerifyResponse { found: boolean; anchor: ChainAnchor | null; block: ChainBlockSummary | null; signatureValid: boolean; chainIntegrity: boolean; steps: VerifyStep[]; merkle: VerifyMerkleProof | null; context: VerifyChainContext | null }
export interface AnchorQuery { source?: AnchorSource; ref?: string; page?: number; pageSize?: number }
export interface AnchorSummary { anchorId: string; subjectHash: string; status: AnchorStatus; blockId: string | null }
