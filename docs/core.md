# Core API Contract

## Module Contract

Status: [DONE]

`app/core` is the only service that owns business persistence. It exposes REST/JSON over HTTP, keeps SQLite private, validates boundary input, issues signed JWTs, enforces the `admin` role with Casbin, records moderation state, and provides aggregated statistics.

Inputs:

- Public HTTP requests from `app/web` or other public clients.
- Authenticated Admin HTTP requests from `app/admin`.
- Environment configuration: `CORE_ADDR`, `CORE_DATABASE_PATH`, `CORE_ALLOWED_ORIGINS`, `CORE_JWT_SECRET`, `CORE_ADMIN_USERNAME`, and `CORE_ADMIN_PASSWORD_HASH`.

Outputs:

- Public API under `/api/v1` for identity, site composition, current status, content streams, projects, comments, and statistics.
- Private API under `/api/v1/admin` for session, content lifecycle, current-status editing, comment moderation, and Admin statistics.
- JSON errors with stable `error.code`, `error.message`, optional `error.details`, and optional `error.requestId`.

Isolation rules:

- No Web or Admin package imports Core Go code.
- No frontend reads or writes the SQLite file.
- Shared TypeScript types travel through `packages/contracts`; HTTP calls travel through `packages/sdk`.
- There is one owner account with the `admin` role; Core exposes no public registration or visitor login flow.

## Design Synthesis

The reference sites suggest one consistent information architecture rather than a conventional blog-only API:

- [Innei](https://innei.in/) treats the home page as an identity surface composed from profile, recent writing, notes, projects, links, quotes, and site metadata. Its navigation separates posts, notes, timeline, thinking, projects, friends, and messages.
- [Koobai](https://koobai.com/) demonstrates a fast thought stream as well as richer personal records such as travel/footprints, photos, exercise, and content that can be drafted and edited from an app.
- [Jun Xie](https://www.seis-jun.xyz/) shows a research-oriented home with recent updates, daily news, a feed reader, paper reviews, and data-heavy weekly reports.

Manifold therefore uses these boundaries:

1. `SiteComposition` is a read model for the home page. It references resources but does not duplicate their full records.
2. `Content` is the common publishing primitive for posts, notes, and research. It supports a compact stream representation and a Markdown detail representation.
3. `NowStatus` is a small, frequently changing presence resource separate from published content.
4. `Project`, `Link`, and future `Experience` resources are independently addressable, while the home page only returns featured references.
5. `Stats` contains server-owned aggregates. Clients display them and do not recompute business metrics.
6. Admin writes use explicit lifecycle transitions so draft, published, and deleted states are auditable and predictable.

The API does not copy presentation-specific cards, layout coordinates, or component names from the references. The contract models the information and the relationships that multiple clients need.

### Reference synthesis (2026-08-23)

The following observations were made from the public pages linked in the project brief:

- [Innei](https://innei.in/) makes identity the entry point, then places recent writing, short notes, lightweight media/musings, projects, friends, quotes, and site links around it. This supports a composed home read model instead of a single chronological posts endpoint.
- [Koobai](https://koobai.com/) treats a personal site as a stream of quick records plus richer sections such as footprints, photos, exercise, reading, drafts, and device-assisted publishing. This supports separating frequently edited `NowStatus` and future `Experience`/`Media` resources from long-form content.
- [Jun Xie](https://www.seis-jun.xyz/) combines diary-like entries with tags, archive navigation, image-backed articles, and recurring research/news collections. This supports `Content` kinds for the MVP and a later `ResearchSeries` family for recurring reports.
- [Karenina-na](https://github.com/Karenina-na) uses profile, repository, contribution, activity, and technology signals as public identity data. This supports keeping `Profile`, `Project`, and future external activity/link resources independently addressable.

The design consequence is a small stable core with additive extension points:

```text
Profile + SiteComposition + NowStatus
                 |
                 +-- Content (POST | NOTE | RESEARCH) -- Comments
                 +-- Project / ExternalLink
                 +-- future Experience / Media
                 +-- future ResearchSeries / ResearchSeriesItem
```

The MVP deliberately does not expose a separate endpoint for every visual section. A new resource family is introduced only when it needs distinct lifecycle, detail shape, moderation, or query semantics. This keeps the public API reusable across the Web, Admin, and future clients while allowing the home page to evolve as a composition of references.

## API Conventions

### Versioning and representation

- Base path: `/api/v1`.
- Media type: `application/json; charset=utf-8`.
- Timestamps: UTC RFC3339 strings.
- IDs are opaque strings. Slugs are lowercase URL-safe strings and are stable public identifiers.
- Public list endpoints return summaries. `body` is returned only by a detail endpoint or an authenticated Admin content read.
- Collection shape is always `{ data, pagination }`.
- Cursor pagination is the default for streams. `limit` defaults to 20 and is capped at 50. Ordering is stable and server-defined.
- Query parameters use camelCase: `kind`, `tag`, `status`, `cursor`, `limit`, and `q`. Date range parameters such as `from` and `to` remain reserved for a future archive query.

### Error envelope

Every non-2xx response uses this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": { "field": "title" },
    "requestId": "req_01J..."
  }
}
```

Status semantics:

| Status | Meaning |
| --- | --- |
| `400` | Malformed request or unsupported query value |
| `401` | Missing or invalid authentication |
| `403` | Authenticated but not allowed to perform the action |
| `404` | Resource does not exist or is not visible to this caller |
| `409` | Unique key or state transition conflict |
| `422` | Well-formed input failed validation |
| `429` | Rate limit exceeded, when public writes are rate limited |
| `500` | Internal failure without implementation details |

### Authentication and writes

- Public reads do not require authentication.
- Public comment creation is rate-limited and always creates `PENDING` moderation state.
- Public reactions use an anonymous visitor identifier from `X-Visitor-ID`; no account is required.
- Admin requests send `Authorization: Bearer <accessToken>`.
- Login tokens expire after the configured session lifetime. The current MVP returns `expiresIn` in seconds.
- `POST` writes that may be retried should accept an `Idempotency-Key`; the server must either replay the original result or reject a conflicting reuse.
- `DELETE` is a soft delete for content. It is idempotent from a public-client perspective: deleted content remains invisible.

## Public API

### MVP endpoints

| Method | Path | Purpose | Status |
| --- | --- | --- | --- |
| `GET` | `/healthz` | Liveness and service version | `[DONE]` |
| `GET` | `/api/v1/profile` | Public identity, biography, and links | `[DONE]` |
| `GET` | `/api/v1/site` | Home-page composition and navigation references | `[DONE]` |
| `GET` | `/api/v1/feed` | Default published stream for the home page | `[DONE]` |
| `GET` | `/api/v1/content` | Published content collection | `[DONE]` |
| `GET` | `/api/v1/content/:slug` | Published Markdown detail | `[DONE]` |
| `GET` | `/api/v1/content/:slug/comments` | Approved comments for a content item | `[DONE]` |
| `POST` | `/api/v1/content/:slug/comments` | Submit a comment for moderation | `[DONE]` |
| `GET` | `/api/v1/content/:slug/reactions` | Read aggregate and visitor-scoped reaction state | `[DONE]` |
| `PUT` | `/api/v1/content/:slug/reactions/:kind` | Add an idempotent visitor reaction | `[DONE]` |
| `DELETE` | `/api/v1/content/:slug/reactions/:kind` | Remove a visitor reaction | `[DONE]` |
| `GET` | `/api/v1/projects` | Curated project collection | `[DONE]` |
| `GET` | `/api/v1/now` | Current focus/status beacon | `[DONE]` |
| `GET` | `/api/v1/stats` | Published-content aggregates | `[DONE]` |

### Query contract

`GET /api/v1/feed` and `GET /api/v1/content` accept the same filter contract:

```text
kind=POST|NOTE|RESEARCH   optional, repeatable or comma-separated
tag=systems               optional exact tag filter
q=boundary                full-text search filter
cursor=<opaque>           cursor returned by the previous response
limit=20                  integer, 1..50
```

Core applies `kind`, `tag`, `q`, `cursor`, and `limit` to a stable server-defined ordering. Cursors are opaque URL-safe tokens; the current implementation encodes a page offset and clients must treat them as values to relay, not inspect.

`GET /api/v1/admin/content` accepts the same filters plus `status=DRAFT|PUBLISHED|DELETED`. Deleted content is excluded from the default Admin list and is returned only when `status=DELETED` is explicit. Public content endpoints reject `status` because deleted and draft records are never public.

### Public resource shapes

`GET /api/v1/site` returns references used to compose the home page:

```json
{
  "profile": { "id": "profile_1" },
  "featuredContent": [{ "id": "content_1", "kind": "POST" }],
  "featuredProjects": [{ "id": "project_1" }],
  "navigation": [{ "label": "Writing", "href": "/writing" }],
  "sections": ["PROFILE", "NOW", "FEED", "PROJECTS"]
}
```

The planned extension adds `externalLinks` and localized navigation labels as optional fields. It does not make clients depend on a fixed section order.

`GET /api/v1/content` returns a summary collection:

```json
{
  "data": [{
    "id": "content_1",
    "kind": "POST",
    "status": "PUBLISHED",
    "slug": "designing-boundaries",
    "title": "Designing Boundaries",
    "summary": "A field note...",
    "tags": ["systems", "design"],
    "publishedAt": "2026-08-23T08:00:00Z",
    "createdAt": "2026-08-23T08:00:00Z",
    "updatedAt": "2026-08-23T08:00:00Z",
    "version": 1,
    "href": "/writing/designing-boundaries"
  }],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

`GET /api/v1/content/:slug` returns the same resource with a required Markdown `body`. The Web client sanitizes the rendered result; Core does not promise that Markdown is safe HTML.

`POST /api/v1/content/:slug/comments` accepts:

```json
{
  "authorName": "Reader",
  "authorUrl": "https://example.com",
  "body": "A useful note.",
  "replyToId": null
}
```

It returns `201` with the created comment and `status: "PENDING"`. Public comment lists only contain `APPROVED` comments. The MVP does not expose email addresses, IP addresses, moderation notes, or audit fields publicly.

### Reactions

Supported reaction kinds are `LIKE` and `FAVORITE`. The caller identifies a browser or client installation with the `X-Visitor-ID` header. The value is 8-128 ASCII characters from `[A-Za-z0-9_-]`; mutation requests require it, while reads may omit it to receive aggregate counts with both viewer flags set to `false`.

`GET /api/v1/content/:slug/reactions` and successful mutation requests return the same stable shape:

```json
{
  "likeCount": 12,
  "favoriteCount": 3,
  "viewerLiked": true,
  "viewerFavorited": false
}
```

`PUT` is idempotent for the `(content, visitor, kind)` tuple. `DELETE` is also idempotent and returns the resulting summary. Invalid visitor identifiers return `400 VISITOR_ID_INVALID`; unsupported kinds return `400 REACTION_KIND_INVALID`; unavailable or unpublished content returns `404 CONTENT_NOT_FOUND`.

## Admin API

### MVP endpoints

| Method | Path | Purpose | Status |
| --- | --- | --- | --- |
| `POST` | `/api/v1/admin/session` | Verify credentials and issue JWT | `[DONE]` |
| `GET` | `/api/v1/admin/content` | List drafts and published content | `[DONE]` |
| `POST` | `/api/v1/admin/content` | Create a draft | `[DONE]` |
| `PATCH` | `/api/v1/admin/content/:id` | Update editable content fields | `[DONE]` |
| `POST` | `/api/v1/admin/content/:id/publish` | Draft to published transition | `[DONE]` |
| `POST` | `/api/v1/admin/content/:id/unpublish` | Published to draft transition | `[DONE]` |
| `DELETE` | `/api/v1/admin/content/:id` | Soft delete content | `[DONE]` |
| `GET` | `/api/v1/admin/comments` | Moderation queue, optionally filtered by status | `[DONE]` |
| `POST` | `/api/v1/admin/comments/:id/approve` | Approve a pending comment | `[DONE]` |
| `POST` | `/api/v1/admin/comments/:id/reject` | Reject a pending comment | `[DONE]` |
| `GET` | `/api/v1/admin/now` | Read current status in Admin | `[DONE]` |
| `PUT` | `/api/v1/admin/now` | Replace current status | `[DONE]` |
| `GET` | `/api/v1/admin/stats` | Dashboard aggregates | `[DONE]` |

### Configuration and extension endpoints

The configuration endpoints below are implemented in the current MVP. The remaining rows are intentionally deferred extension points:

| Method | Path | Purpose | Priority |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/session` | Validate the current session and return operator identity | P1 |
| `GET/PATCH` | `/api/v1/admin/profile` | Read or replace identity and biography fields | `[DONE]` |
| `GET/PATCH` | `/api/v1/admin/site` | Read or replace home references, navigation, and section order | `[DONE]` |
| `GET/POST/PATCH/DELETE` | `/api/v1/admin/projects` | List and manage project records | `[DONE]` |
| `GET` | `/api/v1/admin/audit-events` | Inspect important writes and moderation actions | P1 |
| `POST` | `/api/v1/admin/content/:id/duplicate` | Create a draft copy without mutating the source | P2 |
| `POST` | `/api/v1/admin/assets` | Upload and attach images or other media | P2 |

Admin content update is a validated partial input with optimistic concurrency:

```json
{
  "title": "Updated title",
  "body": "# Markdown",
  "tags": ["systems"],
  "expectedVersion": 3
}
```

The server returns `409 VERSION_CONFLICT` when `expectedVersion` is stale. This prevents two Admin tabs from silently overwriting one another and is the reason `version` is already present in the public model.

Configuration writes use server-owned resource shapes for responses and input-only shapes for requests. `id` and `updatedAt` are never required from clients:

```json
PATCH /api/v1/admin/profile
{
  "displayName": "Manifold",
  "handle": "@manifold",
  "headline": "A living digital garden for ideas in motion.",
  "bio": "A quiet space for writing, thoughts, and research.",
  "avatarUrl": "",
  "location": "Peking, China",
  "organization": "Independent",
  "websiteUrl": "https://manifold.local"
}
```

`PATCH /api/v1/admin/site` accepts `{ featuredContent, featuredProjects, navigation, sections }`. `POST /api/v1/admin/projects` requires `slug`, `name`, and `status` (`ACTIVE`, `PAUSED`, or `ARCHIVED`); `PATCH` is partial and cannot change a project's slug. Project deletion returns `204` and is intended for removing a curated record, while content deletion remains a soft delete because content has public lifecycle history.

## Resource Boundaries and Extensions

### Content kinds

MVP kinds are `POST`, `NOTE`, and `RESEARCH`.

- `POST` is a substantial authored article.
- `NOTE` is a short thought or journal entry suited to a chronological stream.
- `RESEARCH` is a long-form or source-oriented investigation. Citations remain Markdown in the MVP.

Future formats such as `QUOTE`, `TRAVEL`, or `MEDIA` should be added only when their detail and moderation behavior differ materially from content. Until then, use a content kind plus tags and metadata rather than creating one endpoint per page layout.

### Experiences, links, and research feeds

The references justify three later resource families, but they should not expand the MVP schema prematurely:

- `GET /api/v1/experiences` and `/experiences/:slug` for trips, places, photos, and optional coordinates. Aggregate fields can include `visitCount`, `placeCount`, and `mediaCount`.
- `GET /api/v1/links` for friends, external projects, RSS, GitHub, and contact destinations. Links should have `kind`, `label`, `url`, `description`, `avatarUrl`, and `isFeatured`.
- `GET /api/v1/research/series` and `/research/series/:slug/items` for recurring paper/news/earthquake-style reports. A series item should preserve `source`, `publishedAt`, `summary`, `externalUrl`, and optional structured data without forcing the general content model to understand maps or scientific measurements.

These extensions remain resource-oriented and can be added without changing the existing home-page composition contract.

## Feature Matrix

- [x] [P0] SQLite schema and seed data | Core startup creates profile, content, projects, now-status, and comments tables and can restart safely.
- [x] [P0] Health endpoint | `GET /healthz` returns status and version without database details.
- [x] [P0] Public profile/site/now APIs | Web can retrieve identity, home references, and current status over HTTP.
- [x] [P0] Public content/feed APIs | Only published content is public; lists omit body and details return Markdown.
- [x] [P0] Projects and aggregate stats APIs | Core returns curated projects and server-owned counts.
- [x] [P0] Public comment submission | Validated input enters `PENDING`; public lists contain only `APPROVED` comments.
- [x] [P0] Visitor-scoped reactions | `LIKE` and `FAVORITE` counts and viewer state are persisted through idempotent Core endpoints and isolated by visitor identifier.
- [x] [P0] JWT Admin session | Valid credentials issue an expiring JWT; invalid credentials return `401`.
- [x] [P0] Casbin role protection | Admin routes require a valid JWT with the `admin` role.
- [x] [P0] Admin content lifecycle | Admin can create, edit, publish, unpublish, and soft-delete content.
- [x] [P0] Admin comment moderation | Admin can list, approve, and reject comments.
- [x] [P1] Stable request IDs and audit events | Write logs contain event name, resource ID, operator, request ID, and timestamp; request IDs are returned in headers and structured errors.
- [x] [P1] Cursor/filter implementation | `cursor`, `limit`, `kind`, `tag`, and `q` are validated and applied by Core.
- [x] [P1] Optimistic content concurrency | Admin updates support `expectedVersion` and return `409` on stale writes.
- [x] [P1] Project/profile/site editing | Admin owns all source records that shape the home page; writes are validated, audited, and persisted in Core.
- [x] [P1] API contract regression tests | Invalid input, auth failures, not-found behavior, publication state, comment moderation, and visitor-scoped reactions are tested.

The current MVP leaves `Experience`/media and `ResearchSeries` as additive contract extensions described above; they are intentionally outside the MVP acceptance matrix until their distinct lifecycle and data shapes are implemented.

## State Flows

`Content`: `DRAFT` -> `PUBLISHED` -> `DRAFT`; deletion moves any state to `DELETED` and removes the item from public reads.

`Comment`: `PENDING` -> `APPROVED` or `REJECTED`; only `APPROVED` is public.

`Admin session`: credentials -> signed JWT -> validated role -> protected request -> expiry.

`Experience` (planned): `DRAFT` -> `PUBLISHED` -> `ARCHIVED`; media references are immutable once published.

## Delivery Order

1. `[DONE]` Keep the current public and Admin MVP routes stable while Web and Admin are built against them.
2. `[DONE]` Add request IDs, structured logs, and audit events before adding more write surfaces.
3. `[DONE]` Add cursor/filter behavior and content version conflicts; update SDK query types in the same change.
4. `[DONE]` Add Admin editing for profile, site composition, and projects. Links remain a future resource family.
5. Future extension: add experiences/media and research series only after the core publishing flow is used end to end.

## Completion Standard

Core MVP is complete when all P0 items are `[DONE]`, the public and Admin routes above are covered by integration tests, and `go test ./...`, `go vet ./...`, and the contract type checks pass. P1/P2 additions must extend this contract without changing existing response fields or status semantics.
