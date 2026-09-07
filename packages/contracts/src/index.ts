// Manifold 跨端公共契约。修改规则见 README.md：
// contracts -> sdk -> core -> web/admin -> docs -> tests。
//
// 空值语义约定：
// - `?:` 仅表示"该视图不携带此概念"（如 body 仅详情视图、deletedAt 仅管理端）。
// - `| null` 表示"概念存在但值可空"，Core 一律输出键并以 null 表达空值。

export type ContentKind = "THOUGHT" | "ARTICLE";
export type ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED";
export type ContentSort = "newest" | "oldest" | "updated";

export interface ApiErrorBody { error: { code: string; message: string; details?: unknown; requestId?: string; traceId?: string } }
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
export interface MediaReference { contentId: string; kind: ContentKind; title: string | null; slug: string; status: ContentStatus }
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
export interface ChainAnchor { id: string; subjectHash: string; source: AnchorSource; subjectRef: string; label: string; metadata: AnchorMetadata; siteKeyId: string; sitePublicKey: string; siteSignature: string; createdAt: string; status: AnchorStatus; blockId: string | null }
export interface SubmitAnchorInput { payload: string; label?: string }
export interface SubmitAnchorResponse { anchorId: string; subjectHash: string; status: "pending" }
export interface ChainBlockSummary { id: string; index: number; prevHash: string; timestamp: string; certRoot: string; nonce: number; proofMode: ChainProofMode; difficulty: number; hash: string; anchorCount: number }
export interface ChainBlockDetail extends ChainBlockSummary { certIds: string[]; anchors: ChainAnchor[] }
export interface ChainInfo { height: number; totalAnchors: number; pendingAnchors: number; proofMode: ChainProofMode; difficulty: number; genesisHash: string; tipHash: string; sitePublicKey: string }
export interface VerifyResponse { found: boolean; anchor: ChainAnchor | null; block: ChainBlockSummary | null; signatureValid: boolean; chainIntegrity: boolean }
export interface AnchorQuery { source?: AnchorSource; ref?: string; page?: number; pageSize?: number }
export interface AnchorSummary { anchorId: string; subjectHash: string; status: AnchorStatus; blockId: string | null }
