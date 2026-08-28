export type ContentKind = "THOUGHT" | "ARTICLE";
export type ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED";
export type CommentStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ContentSort = "newest" | "oldest" | "updated";

export interface ApiErrorBody { error: { code: string; message: string; details?: unknown; requestId?: string; traceId?: string } }
export interface HealthStatus { status: "ok"; version: string }
export interface ProfileSeriesItem { name: string; url: string; description: string; category?: string }
export interface ProfileContact { label: string; url: string; handle?: string; icon?: string }
export interface Profile { id: string; displayName: string; handle: string; headline: string; bio: string; avatarUrl: string; location: string; organization: string; websiteUrl: string; resumeUrl?: string; interests?: string[]; education?: Array<{ institution: string; program: string; period: string }>; experience?: Array<{ organization: string; role: string; period: string }>; series?: ProfileSeriesItem[]; contacts?: ProfileContact[]; updatedAt: string }
export type ProfileInput = Omit<Profile, "id" | "updatedAt">
export interface ContentSummary { id: string; kind: ContentKind; status: ContentStatus; slug: string | null; title: string | null; summary: string; excerpt?: string; tags: string[]; publishedAt: string | null; createdAt: string; updatedAt: string; version: number; href: string; viewCount: number; likeCount: number; commentCount: number }
export interface ThoughtMetadata { mood?: string; question?: string; context?: string; source?: string }
export interface ArticleMetadata { readingMinutes?: number; toc?: Array<{ id: string; label: string; level: 2 | 3 }>; frontmatter?: Record<string, string>; technologies?: string[]; language?: string; difficulty?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"; repositoryUrl?: string }
export type ContentMetadata = ThoughtMetadata | ArticleMetadata
type ContentWithMetadata<M, K extends ContentKind> = Omit<ContentSummary, "kind"> & { kind: K; metadata: M }
type AdminContentWithMetadata<M, K extends ContentKind> = ContentWithMetadata<M, K> & { body: string }
type ContentDetailWithMetadata<M, K extends ContentKind> = ContentWithMetadata<M, K> & { body: string }
export type Content = ContentWithMetadata<ThoughtMetadata, "THOUGHT"> | ContentWithMetadata<ArticleMetadata, "ARTICLE">
export type AdminContent = AdminContentWithMetadata<ThoughtMetadata, "THOUGHT"> | AdminContentWithMetadata<ArticleMetadata, "ARTICLE">
export type ContentDetail = ContentDetailWithMetadata<ThoughtMetadata, "THOUGHT"> | ContentDetailWithMetadata<ArticleMetadata, "ARTICLE">
export interface NowStatus { title: string; detail: string; mood: string; updatedAt: string; expiresAt?: string }
export interface Comment { id: string; contentId: string; authorName: string; authorUrl?: string; body: string; status: CommentStatus; createdAt: string; replyToId?: string }
export interface LikeSummary { likeCount: number; viewerLiked: boolean }
export interface Stats { contentCount: number; articleCount: number; thoughtCount: number; wordCount: number; updatedAt: string }
export interface PresenceStatus { activeVisitors: number; observedAt: string }
export interface AdminStats { content: Stats; pendingComments: number }
export interface SiteComposition { profile: { id: string }; featuredContent: Array<{ id: string; kind: ContentKind }>; navigation: SiteNavigationItem[]; sections: string[] }
export interface SiteConfig { featuredContent: Array<{ id: string; kind: ContentKind }>; navigation: SiteNavigationItem[]; sections: string[] }
export type SiteConfigInput = SiteConfig
export interface Pagination { nextCursor: string | null; hasMore: boolean; page?: number; pageSize?: number; totalItems?: number; totalPages?: number }
export interface Collection<T> { data: T[]; pagination: Pagination }
export interface PagePagination { page: number; pageSize: number; totalItems: number; totalPages: number }
export interface ThoughtArchive { featured: Extract<Content, { kind: "THOUGHT" }> | null; data: Array<Extract<Content, { kind: "THOUGHT" }>>; pagination: PagePagination }
export interface ThoughtArchiveQuery { page?: number; limit?: number; tag?: string | string[]; q?: string }
export interface ThoughtConfig { featuredThoughtId: string | null; updatedAt: string }
export interface ThoughtConfigInput { featuredThoughtId: string | null }
export interface ContentQuery { kind?: ContentKind | ContentKind[]; tag?: string | string[]; q?: string; cursor?: string; limit?: number; page?: number; sort?: ContentSort; aiAssisted?: boolean; skipFirst?: boolean }
export interface TagQuery { kind?: ContentKind }
export interface TagSummary { name: string; count: number }
export interface AdminContentQuery extends ContentQuery { status?: ContentStatus }
export interface CommentQuery { status?: CommentStatus; cursor?: string; limit?: number }
export interface CreateCommentInput { authorName?: string; authorUrl?: string; body: string; replyToId?: string }
export interface LoginInput { username: string; password: string }
export interface LoginResponse { accessToken: string; tokenType: "Bearer"; expiresIn: number; user: { username: string; role: "admin" } }
interface BaseContentInput { slug?: string | null; title?: string | null; summary: string; body: string; tags: string[] }
export type ContentInput =
  | (BaseContentInput & { kind: "THOUGHT"; metadata: ThoughtMetadata })
  | (BaseContentInput & { kind: "ARTICLE"; metadata: ArticleMetadata })
export interface UpdateContentInput { kind?: ContentKind; slug?: string | null; title?: string; summary?: string; body?: string; tags?: string[]; metadata?: ContentMetadata; expectedVersion: number }
export interface SiteNavigationItem { label: string; href: string; external?: boolean }
export interface ExperienceSummary { id: string; slug: string; title: string; summary: string; visitedAt: string; location: { label: string; country?: string; latitude?: number; longitude?: number }; mediaCount: number; href: string }
export interface ResearchSeries { id: string; slug: string; title: string; summary: string; cadence: "DAILY" | "WEEKLY" | "IRREGULAR"; updatedAt: string; href: string }
export interface ResearchSeriesItem { id: string; seriesId: string; title: string; source: string; summary: string; publishedAt: string; externalUrl?: string; data?: Record<string, unknown> }
