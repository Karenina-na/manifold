# Manifold API Specification

## Scope

This document is the contract for the public REST API and the Admin write API. It is intentionally defined before Core is split into resource modules.

Manifold is a personal digital garden, not a generic blog CMS. Its API must support four presentation modes:

1. A personal identity and current status.
2. A mixed stream of articles, short thoughts, and research.
3. Curated projects and life or research experiences.
4. Stable pages, links, taxonomy, and search for navigation.

The home page is a composition over resources. It is not a database document and must not become one large response that clients cannot cache or evolve independently.

Reference sources inspected on 2026-08-22:

- [Innei](https://innei.in/), [projects](https://innei.in/en/projects), and [friends](https://innei.in/en/friends)
- [Innei/Shiro](https://github.com/Innei/Shiro)
- [mx-space/core](https://github.com/mx-space/core)
- [Koobai](https://koobai.com/)
- [Jun Xie](https://www.seis-jun.xyz/)
- [Karenina-na](https://github.com/Karenina-na)

The upstream systems provide the resource vocabulary and interaction patterns. Manifold keeps its own domain model and never exposes raw upstream API objects.

## Reference Mapping

| Observed upstream concept | Manifold interface |
| --- | --- |
| Shiro/Mix Space aggregate, latest, timeline, and RSS | `/site`, `/feed`, `/stats`, `/feed.xml` |
| Mix Space posts and Shiro posts | `/content?kind=POST` |
| Mix Space notes, Shiro notes, and thinking streams | `/content?kind=NOTE` plus `/topics` |
| Research-oriented writing and paper sections | `/content?kind=RESEARCH` plus `externalReferences` |
| Shiro pages | `/pages` |
| Curated project pages | `/projects` |
| Friends and link exchange | `/links?kind=FRIEND` |
| Categories, tags, and note series/topics | `/categories`, `/topics`, and content filters |
| Public comment threads and Admin moderation | `/content/:slug/comments` and `/admin/comments` |
| Koobai travel/exercise activity projections | Reserved extension; not part of the writing-core contract |
| GitHub profile and repository signals | Normalized `profile.stats` and curated project `source` |

## Design Summary

| Concern | Manifold decision |
| --- | --- |
| Long-form and short-form content | One canonical `/content` resource with `kind` = `POST`, `NOTE`, or `RESEARCH` |
| Static or special pages | Separate `/pages` resource; pages do not enter the chronological feed by default |
| Homepage | `/site` composition plus independent `/feed`, `/stats`, and resource endpoints |
| Taxonomy | `/categories` for editorial grouping, `/topics` for note series, and string tags for lightweight labels |
| Projects and experiences | Separate curated resources; neither is a GitHub repository mirror |
| External sources | Normalized `source` metadata and explicit Admin sync runs |
| Pagination | Opaque cursor pagination for all collection APIs |
| Content rendering | Core returns source and format; Web owns Markdown, KaTeX, and syntax rendering |
| Comments | Contract reserved as a bounded sub-resource with moderation; implementation follows the publishing core |

## Conventions

All JSON endpoints use the `/api/v1` prefix. Timestamps are RFC 3339 UTC strings. IDs are opaque strings. Slugs are stable URL-safe identifiers and are unique within their resource type. Enum values use `UPPER_SNAKE_CASE`; response fields and query parameters use `camelCase`.

Single resources are returned directly. Collections use:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "opaque-or-null",
    "hasMore": false
  }
}
```

Collection rules:

- `limit` defaults to 20 and is capped at 100.
- `cursor` is opaque and URL encoded. Clients must not decode or construct it.
- Public content sorts by `publishedAt DESC`; curated resources sort by `sortOrder` and then `updatedAt DESC`.
- Unknown filters and invalid enum values return `400 INVALID_QUERY`.
- List responses omit large `body` fields unless `include=body` is explicitly supported by that endpoint.

Every error uses this envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be validated.",
    "details": {},
    "requestId": "req_01..."
  }
}
```

Status meanings: `400` malformed input, `401` unauthenticated, `403` forbidden, `404` missing resource, `409` conflict or stale version, `422` domain validation failure, `429` rate limited, `500` internal failure, `502` external provider failure.

Public GET responses should support `ETag` and `Last-Modified`. Admin and draft responses are `Cache-Control: no-store`.

Admin mutations accept `If-Match` when a resource exposes an ETag. A stale write returns `409 VERSION_CONFLICT`. `Idempotency-Key` is supported on create and state-transition requests.

## Public Read API

### Platform and Composition

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness and application version; never exposes database details |
| GET | `/api/v1/site` | Homepage composition and public navigation |
| GET | `/api/v1/stats` | Derived writing statistics |
| GET | `/api/v1/feed` | Compact chronological stream |
| GET | `/feed.xml` | RSS/Atom representation of published content |
| GET | `/sitemap.xml` | Sitemap representation of published routes |

`GET /api/v1/site` returns references rather than full documents:

```json
{
  "profile": { "id": "profile_1" },
  "featuredContent": [{ "id": "content_1", "kind": "POST" }],
  "featuredProjects": [{ "id": "project_1" }],
  "navigation": [{ "label": "Writing", "href": "/writing" }],
  "sections": ["PROFILE", "FEED", "PROJECTS", "EXPERIENCES", "NOW", "LINKS"],
  "updatedAt": "2026-08-22T00:00:00Z"
}
```

`GET /api/v1/stats` returns `contentCount`, `postCount`, `noteCount`, `researchCount`, `wordCount`, `activeSince`, and `updatedAt`. Counts are informational and may be eventually consistent.

`GET /api/v1/feed` supports `kind`, `tag`, `category`, `topic`, `from`, and `to`. Each item is a compact link:

```json
{
  "id": "content_1",
  "kind": "POST",
  "slug": "designing-boundaries",
  "title": "Designing Boundaries",
  "summary": "...",
  "publishedAt": "2026-08-20T10:00:00Z",
  "updatedAt": "2026-08-20T10:00:00Z",
  "tags": ["engineering"],
  "href": "/writing/designing-boundaries"
}
```

Feed is a derived read model. It may later include selected experience or project events while keeping this link-oriented shape.

### Profile

| Method | Path |
| --- | --- |
| GET | `/api/v1/profile` |

Profile fields are `id`, `displayName`, `handle`, `headline`, `bio`, `avatarUrl`, `location`, `organization`, `websiteUrl`, `socials`, `stats`, and `updatedAt`.

`socials` contains `{ provider, label, url }`. `stats` may contain `publicRepositories`, `followers`, and `following`; provider statistics are optional, informational, and always carry the profile's `updatedAt` freshness boundary.

### Content

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/content` | List published posts, notes, and research |
| GET | `/api/v1/content/:slug` | Get one published content document |

Supported kinds:

- `POST`: long-form writing, analogous to an article or blog post.
- `NOTE`: a short thought or thinking-stream entry.
- `RESEARCH`: a long-form research note with citations and external references.

`GET /api/v1/content` supports `kind`, `tag`, `category`, `topic`, `publishedAfter`, `publishedBefore`, `featured`, `limit`, and `cursor`. A list item contains `id`, `kind`, `slug`, `title`, `summary`, `tags`, `category`, `topics`, `cover`, `publishedAt`, `updatedAt`, and `href`.

The detail response adds `status`, `body`, `contentFormat`, `readingTimeMinutes`, `createdAt`, `externalReferences`, and `version`:

```json
{
  "id": "content_1",
  "kind": "RESEARCH",
  "status": "PUBLISHED",
  "slug": "fault-tolerant-systems",
  "title": "Fault-Tolerant Systems",
  "summary": "A research note...",
  "body": "# Fault-Tolerant Systems\n",
  "contentFormat": "MARKDOWN",
  "tags": ["systems"],
  "category": { "id": "category_1", "slug": "research", "name": "Research" },
  "topics": [],
  "externalReferences": [{ "label": "Paper", "url": "https://doi.org/..." }],
  "publishedAt": "2026-08-20T10:00:00Z",
  "createdAt": "2026-08-19T10:00:00Z",
  "updatedAt": "2026-08-20T10:00:00Z",
  "version": 3
}
```

Only `PUBLISHED` content is public. The canonical public locator is `slug`, including for notes. Web owns Markdown, KaTeX, and Shiki rendering.

### Pages

| Method | Path |
| --- | --- |
| GET | `/api/v1/pages` |
| GET | `/api/v1/pages/:slug` |

Pages are stable, manually curated documents such as an about page, equipment page, or a research-method page. They have `id`, `slug`, `title`, `summary`, `body`, `contentFormat`, `publishedAt`, `updatedAt`, and `version`. Pages do not appear in `/feed` unless explicitly promoted by the site composition.

### Projects and Experiences

| Method | Path |
| --- | --- |
| GET | `/api/v1/projects` |
| GET | `/api/v1/projects/:slug` |
| GET | `/api/v1/experiences` |
| GET | `/api/v1/experiences/:id` |

Project fields are `id`, `slug`, `name`, `summary`, `description`, `status`, `featured`, `homepageUrl`, `repositoryUrl`, `logoUrl`, `techStack`, `highlights`, `startedAt`, `endedAt`, `source`, and `updatedAt`. `status` is one of `IDEA`, `ACTIVE`, `MAINTAINED`, `PAUSED`, or `ARCHIVED`.

Experience fields are `id`, `kind`, `organization`, `role`, `title`, `summary`, `startDate`, `endDate`, `location`, `highlights`, `links`, and `updatedAt`. `kind` is one of `WORK`, `EDUCATION`, `RESEARCH`, `AWARD`, or `OTHER`.

These resources are curated projections. A GitHub repository can be a project source, but a GitHub repository is not automatically a public Manifold project.

### Now and Links

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/now` | Current focus/status singleton |
| GET | `/api/v1/links` | Friends, social links, and useful resources |

The now response contains `title`, `detail`, `mood`, `updatedAt`, and `expiresAt`. `mood` is one of `FOCUSED`, `EXPLORING`, `RESTING`, `TRAVELING`, `OFFLINE`, or `OTHER`.

Link fields are `id`, `kind`, `name`, `description`, `url`, `avatarUrl`, `featured`, `sortOrder`, and `updatedAt`. `kind` is one of `FRIEND`, `SOCIAL`, `RESOURCE`, or `OTHER`. Link-health state is internal moderation metadata and is not part of the stable public object.

### Taxonomy

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/categories` | List editorial categories |
| GET | `/api/v1/categories/:slug` | Get category metadata and content reference page |
| GET | `/api/v1/topics` | List note topics/series |
| GET | `/api/v1/topics/:slug` | Get topic metadata and paginated notes |

Categories contain `id`, `slug`, `name`, `description`, and `contentCount`. Topics contain `id`, `slug`, `name`, `description`, `coverUrl`, `noteCount`, and `updatedAt`. Taxonomy endpoints never duplicate complete content bodies.

### Search and Comments

`GET /api/v1/search?q=systems&kind=POST,RESEARCH&limit=20&cursor=opaque` is a phase-three endpoint with a fixed shape. Results contain `type`, `id`, `title`, `summary`, `highlight`, and `href`.

Comments are a bounded phase-four sub-resource:

- `GET /api/v1/content/:slug/comments`
- `POST /api/v1/content/:slug/comments`

Public comment creation is rate-limited and initially enters `PENDING` moderation. The input contains `authorName`, optional `authorEmail`, optional `authorUrl`, `body`, and optional `replyToId`. No public endpoint exposes private moderation fields.

## Admin Write API

Admin endpoints use the same versioned namespace and require an authenticated session or bearer token. Authentication is a platform concern and is not duplicated inside resource services.

### Session

- `GET /api/v1/admin/session`
- `POST /api/v1/admin/session`
- `DELETE /api/v1/admin/session`

### Content and Pages

- `GET, POST /api/v1/admin/content`
- `GET, PATCH, DELETE /api/v1/admin/content/:id`
- `POST /api/v1/admin/content/:id/publish`
- `POST /api/v1/admin/content/:id/unpublish`
- `GET, POST /api/v1/admin/pages`
- `GET, PATCH, DELETE /api/v1/admin/pages/:id`
- `POST /api/v1/admin/pages/:id/publish`
- `POST /api/v1/admin/pages/:id/unpublish`

Content create input requires `kind`, `slug`, `title`, and `body`; pages require `slug`, `title`, and `body`. New records are `DRAFT`. Publishing is an explicit transition. Unpublishing retains the body and returns the record to `DRAFT`. Delete is soft-delete. Updates use `If-Match` or an explicit `version` field.

### Singleton and Curated Resources

- `GET, PATCH /api/v1/admin/profile`
- `GET, PATCH /api/v1/admin/site`
- `GET, PUT /api/v1/admin/now`
- `GET, POST /api/v1/admin/projects`
- `GET, PATCH, DELETE /api/v1/admin/projects/:id`
- `GET, POST /api/v1/admin/experiences`
- `GET, PATCH, DELETE /api/v1/admin/experiences/:id`
- `GET, POST /api/v1/admin/links`
- `PATCH, DELETE /api/v1/admin/links/:id`
- `POST /api/v1/admin/links/reorder`
- `GET, POST /api/v1/admin/categories`
- `GET, PATCH, DELETE /api/v1/admin/categories/:id`
- `GET, POST /api/v1/admin/topics`
- `GET, PATCH, DELETE /api/v1/admin/topics/:id`

### Comments and Sources

Comment moderation endpoints are:

- `GET /api/v1/admin/comments?status=PENDING`
- `POST /api/v1/admin/comments/:id/approve`
- `POST /api/v1/admin/comments/:id/reject`
- `DELETE /api/v1/admin/comments/:id`
- `POST /api/v1/admin/comments/:id/reply`

External source synchronization endpoints are:

- `GET /api/v1/admin/sources`
- `POST /api/v1/admin/sources/github/sync`
- `GET /api/v1/admin/sources/github/runs/:id`

GitHub sync returns a run resource with `id`, `provider`, `status`, `startedAt`, `finishedAt`, and `summary`. `status` is one of `QUEUED`, `RUNNING`, `SUCCEEDED`, `PARTIAL`, or `FAILED`. Sync updates curated profile/project projections only when configured and never publishes content automatically.

## Ownership and Delivery Phases

| Resource | Public | Admin | Phase | Owner |
| --- | --- | --- | --- | --- |
| site, profile, stats, now | read | update | 1 | Manifold |
| content and feed | published read | full lifecycle | 1 | Manifold |
| projects, experiences, links | read | full lifecycle | 2 | Manifold |
| pages, categories, topics | read | full lifecycle | 2 | Manifold |
| GitHub source runs | no public read | create/read | 3 | Integration adapter |
| search | read | index maintenance | 3 | Derived index |
| comments | moderated public read/write | moderation | 4 | Comment service |

## Compatibility Rules

Add optional response fields without changing existing meanings. Do not rename or remove public fields without a versioned migration. Keep provider fields under `source` or `externalReferences`. Never expose raw GitHub, RSS, or external-site objects as Manifold resources. Keep `/site`, `/feed`, and `/stats` as derived read models so their internal composition can change without changing resource contracts.

## Implementation Order

1. Platform, health, request IDs, CORS, authentication seam, SQLite connection, and migrations.
2. Profile, site composition, now, and stats.
3. Content draft/publish lifecycle and public detail.
4. Feed and RSS read models.
5. Projects, experiences, and links.
6. Pages, categories, and topics.
7. GitHub source adapter and sync runs.
8. Search index.
9. Comments and moderation.
