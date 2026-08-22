# Core API Contract

## Module Contract

Status: [WIP]

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

## API Conventions

### Versioning and representation

- Base path: `/api/v1`.
- Media type: `application/json; charset=utf-8`.
- Timestamps: UTC RFC3339 strings.
- IDs are opaque strings. Slugs are lowercase URL-safe strings and are stable public identifiers.
- Public list endpoints return summaries. `body` is returned only by a detail endpoint or an authenticated Admin content read.
- Collection shape is always `{ data, pagination }`.
- Cursor pagination is the default for streams. `limit` defaults to 20 and is capped at 50. Ordering is stable and server-defined.
- Query parameters use camelCase: `kind`, `tag`, `status`, `cursor`, `limit`, `q`, `from`, and `to`.

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
| `GET` | `/api/v1/projects` | Curated project collection | `[DONE]` |
| `GET` | `/api/v1/now` | Current focus/status beacon | `[DONE]` |
| `GET` | `/api/v1/stats` | Published-content aggregates | `[DONE]` |

### Query contract

`GET /api/v1/feed` and `GET /api/v1/content` accept the same planned filter contract:

```text
kind=POST|NOTE|RESEARCH   optional, repeatable or comma-separated
tag=systems               optional exact tag filter
q=boundary                planned full-text search filter
cursor=<opaque>           cursor returned by the previous response
limit=20                  integer, 1..50
```

The current Core implementation returns one page with `nextCursor: null`. The cursor and filter names are fixed now so the Web client does not need a breaking change when the store becomes paginated.

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

### Planned Admin endpoints

These are part of the target interface but are not required for the current Core MVP:

| Method | Path | Purpose | Priority |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/session` | Validate the current session and return operator identity | P1 |
| `GET/PATCH` | `/api/v1/admin/profile` | Edit identity and biography | P1 |
| `GET/PATCH` | `/api/v1/admin/site` | Edit home composition and navigation | P1 |
| `GET/POST/PATCH/DELETE` | `/api/v1/admin/projects` | Manage project records | P1 |
| `GET` | `/api/v1/admin/audit-events` | Inspect important writes and moderation actions | P1 |
| `POST` | `/api/v1/admin/content/:id/duplicate` | Create a draft copy without mutating the source | P2 |
| `POST` | `/api/v1/admin/assets` | Upload and attach images or other media | P2 |

Admin content update is currently a validated full input. The target contract is a partial update with optimistic concurrency:

```json
{
  "title": "Updated title",
  "body": "# Markdown",
  "tags": ["systems"],
  "expectedVersion": 3
}
```

The server returns `409 VERSION_CONFLICT` when `expectedVersion` is stale. This prevents two Admin tabs from silently overwriting one another and is the reason `version` is already present in the public model.

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
- [x] [P0] JWT Admin session | Valid credentials issue an expiring JWT; invalid credentials return `401`.
- [x] [P0] Casbin role protection | Admin routes require a valid JWT with the `admin` role.
- [x] [P0] Admin content lifecycle | Admin can create, edit, publish, unpublish, and soft-delete content.
- [x] [P0] Admin comment moderation | Admin can list, approve, and reject comments.
- [x] [P1] Stable request IDs and audit events | Write logs contain event name, resource ID, operator, request ID, and timestamp; request IDs are returned in headers and structured errors.
- [ ] [P1] Cursor/filter implementation | `cursor`, `limit`, `kind`, `tag`, and `q` are validated and applied by Core.
- [ ] [P1] Optimistic content concurrency | Admin updates support `expectedVersion` and return `409` on stale writes.
- [ ] [P1] Project/profile/site editing | Admin owns all source records that shape the home page.
- [ ] [P2] Experiences and media | Travel-like records can include images, places, and optional geodata through dedicated assets.
- [ ] [P2] Research series | Recurring data-heavy reports are addressable without overloading `Content`.
- [x] [P1] API contract regression tests | Invalid input, auth failures, not-found behavior, publication state, and comment moderation are tested.

## State Flows

`Content`: `DRAFT` -> `PUBLISHED` -> `DRAFT`; deletion moves any state to `DELETED` and removes the item from public reads.

`Comment`: `PENDING` -> `APPROVED` or `REJECTED`; only `APPROVED` is public.

`Admin session`: credentials -> signed JWT -> validated role -> protected request -> expiry.

`Experience` (planned): `DRAFT` -> `PUBLISHED` -> `ARCHIVED`; media references are immutable once published.

## Delivery Order

1. `[DONE]` Keep the current public and Admin MVP routes stable while Web and Admin are built against them.
2. `[TODO]` Add request IDs, structured logs, and audit events before adding more write surfaces.
3. `[TODO]` Add cursor/filter behavior and content version conflicts; update SDK query types in the same change.
4. `[TODO]` Add Admin editing for profile, site composition, projects, and links.
5. `[TODO]` Add experiences/media and research series only after the core publishing flow is used end to end.

## Completion Standard

Core MVP is complete when all P0 items are `[DONE]`, the public and Admin routes above are covered by integration tests, and `go test ./...`, `go vet ./...`, and the contract type checks pass. P1/P2 additions must extend this contract without changing existing response fields or status semantics.
