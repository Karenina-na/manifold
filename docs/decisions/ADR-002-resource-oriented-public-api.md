# ADR-002: Resource-Oriented Public API and Derived Homepage Reads

## Status

Accepted

## Date

2026-08-22

## Context

Manifold needs to present a personal identity, a mixed stream of writing and thoughts, research, projects, experiences, current status, friends, and external links. The homepage must be easy for Web to render and cache, while Admin needs predictable CRUD and publishing workflows.

The main references are Innei/Shiro and Mix Space Core. Those systems distinguish posts, notes, pages, projects, links, taxonomy, comments, and search, and provide aggregate endpoints for homepage-oriented reads. Koobai and seis-jun add examples of activity streams, curated external sites, and research-focused sections.

The first Manifold scaffold contains a smaller `entries` model. That model is useful as a bootstrap, but it is not sufficient as the long-term ownership boundary: it cannot express pages, note topics, curated projects, experiences, or moderation without leaking conditionals into every consumer.

## Decision

Use a resource-oriented REST API with a small number of derived read models.

### Canonical resources

- `profile` and `site` for identity and presentation configuration.
- `content` with the discriminated `kind` values `POST`, `NOTE`, and `RESEARCH`.
- `pages` for stable manually curated documents.
- `projects`, `experiences`, `now`, and `links` for curated non-content surfaces.
- `categories`, `topics`, and tags for content discovery.
- `comments` as a bounded moderated sub-resource.

### Derived read models

- `/site` returns references and visible sections for homepage composition.
- `/feed` returns compact chronological links.
- `/stats` returns informational writing statistics.
- `/search` returns index results and never becomes the owner of source documents.

### Lifecycle and transport rules

- Public reads expose published and curated data only.
- Admin writes use explicit publish transitions, soft deletion, optimistic concurrency, and idempotency keys where needed.
- Collections use opaque cursor pagination and a stable `{ data, pagination }` envelope.
- Errors use one structured envelope with a machine-readable code and request ID.
- Provider data is normalized under `source`; raw GitHub objects are never part of the public contract.

## Alternatives Considered

### One generic `entries` endpoint

Rejected as the long-term ownership model. It makes pages, note topics, comments, project cards, and lifecycle differences conditional fields on one large type. A unified content query remains useful, but the service owns a discriminated content model and separate resources own their own behavior.

### Clone Mix Space endpoint names one for one

Rejected. Mix Space is a mature CMS with features such as translation, readers, AI enrichment, and membership. Manifold should borrow proven boundaries and read patterns without importing provider-specific names or operational complexity.

### One homepage JSON document containing all data

Rejected. It couples profile, content, projects, and links to the same cache key and makes every small edit invalidate the entire page. `/site` is intentionally a composition of references and read models.

### GraphQL as the first public contract

Rejected for the initial system. REST keeps caching, RSS, Admin tooling, and the native fetch SDK straightforward. A future GraphQL or typed query layer can be added without changing resource ownership.

## Consequences

Positive:

- Web, Admin, and future clients share stable resource contracts.
- Core can split services along meaningful ownership boundaries.
- Homepage composition can evolve without duplicating source data.
- Notes, research, and posts share discovery while retaining a clear discriminator.
- External integrations remain replaceable and cannot redefine the public domain model.

Costs:

- More modules and endpoints than a single `entries` table.
- Derived read models need explicit cache and freshness policies.
- The initial scaffold contracts and schema must be migrated toward the documented target incrementally.

## References

- https://innei.in/
- https://github.com/Innei/Shiro
- https://github.com/mx-space/core
- https://koobai.com/
- https://www.seis-jun.xyz/
