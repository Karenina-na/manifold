export type EntryKind = "article" | "thought" | "research";
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }
export interface HealthStatus { status: "ok" }
export interface Profile { name: string; bio: string; location: string; avatarUrl: string; updatedAt: string }
export interface Entry { id: string; kind: EntryKind; slug: string; title: string; excerpt: string; content: string; publishedAt: string; updatedAt: string }
export interface NowStatus { title: string; detail: string; updatedAt: string }
export interface EntriesResponse { data: Entry[]; meta: { total: number } }
