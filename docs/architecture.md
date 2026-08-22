# Manifold Architecture

## Purpose

Manifold is an API-first personal digital garden. The public website, the mobile-first Admin PWA, and future clients consume the same Go Core contract through `@manifold/sdk`.

The architecture follows the API contract in [`api-spec.md`](api-spec.md). The contract is resource-oriented, while the homepage and feed are read models composed from those resources.

## Reference Model

The primary design reference is the Innei/Shiro and Mix Space ecosystem:

- Shiro separates posts, notes, pages, projects, friends, says, and thinking views.
- Mix Space Core separates post, note, page, project, link, category, topic, comment, search, and aggregate modules.
- The aggregate endpoints provide homepage metadata, latest content, timeline, RSS, and statistics without making the aggregate object the ownership boundary.
- Koobai demonstrates that activity data such as travel and exercise can be valuable projections, but those should be optional extensions rather than requirements of the writing core.
- seis-jun demonstrates a compact latest stream plus curated sites and research-oriented sections.

Manifold adopts the resource boundaries and composition pattern, but keeps a smaller domain model suited to one personal knowledge space.

## Public Composition

```text
GET /api/v1/site
  -> profile reference
  -> featured content references
  -> featured project references
  -> navigation and visible section keys

GET /api/v1/feed       -> published content links
GET /api/v1/stats      -> derived writing statistics
GET /api/v1/profile    -> personal identity
GET /api/v1/projects   -> curated work
GET /api/v1/experiences -> work, education, and research history
GET /api/v1/now        -> current focus
GET /api/v1/links      -> friends, social, and resource links
```

`site` contains references and presentation configuration. It does not embed full content bodies, project descriptions, or a second copy of profile data. This keeps cache invalidation and ownership explicit.

## Runtime Flow

```text
Web / Admin
    |
    v
@manifold/sdk
    |
    v
Core HTTP handlers
    |
    v
Domain services
    |
    v
Repository interfaces
    |
    v
SQLite / sqlc store

Core services ---> source adapters ---> GitHub and other external providers
```

Web and Admin do not call SQLite or external providers directly. The SDK owns transport concerns such as base URLs, bearer tokens, request errors, and future retries. Core validates all external input at the HTTP boundary and all provider responses at the adapter boundary.

## Target Core Layout

```text
apps/core/
├── cmd/server/main.go
├── internal/
│   ├── platform/              # config, HTTP, auth, request IDs, cache headers
│   ├── profile/               # owner identity and provider projections
│   ├── site/                  # navigation and homepage composition
│   ├── stats/                 # derived counts and writing statistics
│   ├── content/               # POST, NOTE, RESEARCH and lifecycle transitions
│   ├── feed/                  # chronological content read model and RSS
│   ├── pages/                 # stable manually curated documents
│   ├── projects/              # curated project records
│   ├── experiences/           # work, education, research, and awards
│   ├── now/                   # current focus singleton
│   ├── links/                 # friends, social, and resource links
│   ├── taxonomy/              # categories, topics, and tag queries
│   ├── search/                # phase-three derived search index
│   ├── comments/              # phase-four public comments and moderation
│   ├── sources/github/        # normalized GitHub adapter and sync runs
│   └── store/                 # sqlc-generated queries and repository mappings
├── db/schema.sql
└── db/queries.sql
```

The current repository is only the foundation. The target directories are introduced incrementally in the order defined by the API specification; empty package structure should not be created ahead of an implemented use case.

## Dependency Rules

1. HTTP handlers depend on domain service interfaces and request/response mappers.
2. Domain services own business rules, lifecycle transitions, and read-model composition.
3. Repository interfaces hide persistence from services.
4. The store owns SQL, row mapping, transaction boundaries, and sqlc-generated code.
5. Feed, stats, site, and search are read models. They may query projections or compose multiple repositories, but they do not become write owners of source resources.
6. The GitHub adapter maps untrusted provider payloads into Manifold-owned profile and project projections.
7. Authentication, CORS, request logging, request IDs, and conditional caching belong to `platform` middleware.
8. Contracts in `packages/contracts` describe the public boundary. `packages/sdk` is the only TypeScript transport client.

## Resource Ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `content` | content identity, body, kind, tags, publication lifecycle | homepage layout or search ranking |
| `site` | navigation, section visibility, featured references | content bodies |
| `feed` | chronological projection and RSS serialization | publishing state transitions |
| `projects` | curated project metadata | arbitrary GitHub repository objects |
| `experiences` | manually curated history | generated profile statistics |
| `taxonomy` | categories, topics, and tag lookup | duplicate content documents |
| `sources/github` | provider fetch, validation, normalization, sync run state | automatic publishing |
| `comments` | moderation lifecycle and public thread projection | private auth/session policy |

## State and Consistency

Content starts as `DRAFT`, becomes public only through an explicit publish transition, and returns to `DRAFT` when unpublished. Soft deletion preserves the record for recovery and prevents a stale public URL from silently being reused.

The source resources are transactionally consistent within Core. Derived read models such as stats, feed indexes, and search may be eventually consistent. Their responses must expose `updatedAt` where freshness matters.

Admin updates use optimistic concurrency via ETags or a version field. This prevents a stale mobile Admin form from overwriting a newer edit.

## Incremental Delivery

1. Platform foundation: health, config, request IDs, CORS, auth seam, SQLite, and migrations.
2. Profile, site, now, and stats: enough for a useful identity-first homepage.
3. Content: create, edit, draft, publish, unpublish, list, and detail.
4. Feed and RSS: compact stream and cacheable syndication output.
5. Projects, experiences, and links: curated portfolio and network surfaces.
6. Pages and taxonomy: stable special pages, categories, topics, and tag filtering.
7. GitHub source synchronization: normalized provider metadata and run status.
8. Search: derived index behind the fixed public response shape.
9. Comments: rate-limited public submission and Admin moderation.

Each step should be independently testable and committed before the next module is split out.
