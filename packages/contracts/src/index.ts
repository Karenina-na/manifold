export type ContentKind = "POST" | "NOTE" | "RESEARCH";
export type ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED";
export type CommentStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ContentSort = "publishedAt" | "createdAt" | "updatedAt";

export interface ApiErrorBody { error: { code: string; message: string; details?: unknown; requestId?: string } }
export interface HealthStatus { status: "ok"; version: string }
export interface Profile { id: string; displayName: string; handle: string; headline: string; bio: string; avatarUrl: string; location: string; organization: string; websiteUrl: string; updatedAt: string }
export type ProfileInput = Omit<Profile, "id" | "updatedAt">
export interface ContentSummary { id: string; kind: ContentKind; status: ContentStatus; slug: string; title: string; summary: string; tags: string[]; publishedAt: string | null; createdAt: string; updatedAt: string; version: number; href: string }
export interface Content extends ContentSummary { body?: string }
export interface ContentDetail extends ContentSummary { body: string }
export type ProjectStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export interface Project { id: string; slug: string; name: string; summary: string; description: string; status: ProjectStatus; featured: boolean; homepageUrl: string; repositoryUrl: string; techStack: string[]; startedAt: string; updatedAt: string }
export type CreateProjectInput = Omit<Project, "id" | "updatedAt">
export type UpdateProjectInput = Partial<Omit<Project, "id" | "slug" | "updatedAt">>
export interface NowStatus { title: string; detail: string; mood: string; updatedAt: string; expiresAt?: string }
export interface Comment { id: string; contentId: string; authorName: string; authorUrl?: string; body: string; status: CommentStatus; createdAt: string; replyToId?: string }
export interface Stats { contentCount: number; postCount: number; noteCount: number; researchCount: number; wordCount: number; updatedAt: string }
export interface AdminStats { content: Stats; pendingComments: number }
export interface SiteComposition { profile: { id: string }; featuredContent: Array<{ id: string; kind: ContentKind }>; featuredProjects: Array<{ id: string }>; navigation: SiteNavigationItem[]; sections: string[]; externalLinks?: ExternalLink[] }
export interface SiteConfig { featuredContent: Array<{ id: string; kind: ContentKind }>; featuredProjects: Array<{ id: string }>; navigation: SiteNavigationItem[]; sections: string[] }
export type SiteConfigInput = SiteConfig
export interface Pagination { nextCursor: string | null; hasMore: boolean }
export interface Collection<T> { data: T[]; pagination: Pagination }
export interface ContentQuery { kind?: ContentKind | ContentKind[]; tag?: string; q?: string; cursor?: string; limit?: number }
export interface AdminContentQuery extends ContentQuery { status?: ContentStatus }
export interface CommentQuery { status?: CommentStatus; cursor?: string; limit?: number }
export interface CreateCommentInput { authorName: string; authorUrl?: string; body: string; replyToId?: string }
export interface LoginInput { username: string; password: string }
export interface LoginResponse { accessToken: string; tokenType: "Bearer"; expiresIn: number; user: { username: string; role: "admin" } }
export interface ContentInput { kind: ContentKind; slug: string; title: string; summary: string; body: string; tags: string[] }
export interface UpdateContentInput { title?: string; summary?: string; body?: string; tags?: string[]; expectedVersion: number }
export interface SiteNavigationItem { label: string; href: string; external?: boolean }
export interface ExternalLink { id: string; kind: "FRIEND" | "PROJECT" | "CONTACT" | "FEED" | "OTHER"; label: string; url: string; description?: string; avatarUrl?: string; isFeatured: boolean }
export interface ExperienceSummary { id: string; slug: string; title: string; summary: string; visitedAt: string; location: { label: string; country?: string; latitude?: number; longitude?: number }; mediaCount: number; href: string }
export interface ResearchSeries { id: string; slug: string; title: string; summary: string; cadence: "DAILY" | "WEEKLY" | "IRREGULAR"; updatedAt: string; href: string }
export interface ResearchSeriesItem { id: string; seriesId: string; title: string; source: string; summary: string; publishedAt: string; externalUrl?: string; data?: Record<string, unknown> }
