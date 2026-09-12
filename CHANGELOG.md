# Changelog

All notable changes to this repository are recorded here. The project uses
[Conventional Commits](https://www.conventionalcommits.org/); per-change detail
lives in `git log`, and this file summarises the state of the tree.

## Unreleased

Baseline: the last recorded release was the workspace scaffold. Everything
below landed after it.

### Added

- **Core content model** — single-table `content` with the `THOUGHT` and
  `ARTICLE` kinds, tags, excerpts, version guards, draft/publish/withdraw
  lifecycle, archives with search/tag/sort/pagination, and a home timeline
  aggregate.
- **Core engagement** — instant-publish comments with threaded replies,
  pagination and thread search; admin moderation (soft delete, hide/unhide,
  author edit); likes; deduplicated visitor view events; anonymous presence.
- **Core auth** — DB-backed admin credentials and revocable sessions
  (`logout`, per-session logout, logout-all, change password), plus GitHub
  OAuth visitor sessions used as comment identities.
- **Core media** — upload, serving, library listing and per-file reference
  listing, with SHA-256 dedup, MIME sniffing and an explicit SVG rejection.
- **Core anchoring chain** — ed25519 site key, signed certificates, mined
  blocks (sim and proof-of-work modes), full-chain replay verification, public
  anchor submission, and the query surface behind the Web chain explorer.
- **Core operations** — request/trace identifiers, request audit trail,
  content/stats caches, system metrics, per-client rate limiting, and a
  graceful-shutdown lifecycle.
- **`packages/contracts`** — the shared request/response types, discriminated
  unions and the `ApiErrorCode` union that Core's Go constants are checked
  against.
- **`packages/sdk`** — the typed `fetch` client: auth, trace and visitor
  headers, typed error parsing, and one method per Core route.
- **`packages/render`** — the shared Markdown reading surfaces used by both
  Web and Admin, with a real sanitize boundary.
- **Web** — Home (stats, tags, contribution activity, zoomable timeline),
  Thoughts and Writings archives and detail reading shells, article image
  lightbox, reading progress rail, floating REPL, comment thread with the
  GitHub sign-in gate, and the chain explorer.
- **Admin** — workspaces for profile, site composition, per-kind pinning,
  content, comments, media library and security settings; a dashboard hub; and
  a Markdown editor with a GFM toolbar and inline image uploads.
- **Release tooling** — a Linux x64 bundle (`package:release`) containing
  Core, Web and Admin, driven by a supervisor with
  `start | stop | restart | status`, generated initial admin credentials and
  hardened runtime permissions.
- **`docs/design-system`** — design tokens, component specifications and a
  validation gate.

### Changed

- **Content contract unified across contracts, sdk, core, web and admin**
  (breaking). The single-table `THOUGHT`/`ARTICLE` model replaced the earlier
  per-type resources; Projects, Technology, Manuscript and Now are no longer
  part of the product surface.
- Reactions were replaced by likes.
- Core reads call `internal/store` directly; `internal/application` carries
  write use cases and their audit, anchoring and cache-invalidation
  orchestration.
- Admin was restructured around workspaces and split into lazy chunks.

### Fixed

- **Chain proof mode**: the block timestamp was rewritten after the
  proof-of-work search, so the stored hash no longer matched the pre-image
  whose nonce satisfied the target and every proof block replayed as tampered.
- **Web security**: session cookies are marked `Secure`, a Content-Security
  Policy with a per-request nonce is served, and the REPL no longer evaluates
  user input with `Function()`.
- **Core authority**: profile field lengths and URL schemes are enforced in
  Core rather than only in the Admin form; mining difficulty is bounded and
  rejected at startup when out of range.
- **Core correctness**: search and filters match LIKE metacharacters
  literally; a credential-store failure is reported as a server error instead
  of "wrong password"; session ids fail closed when the CSPRNG is unavailable;
  the chain read path no longer writes.
- **Release runtime**: a killed supervisor's orphaned services are reclaimed,
  the pid file is written atomically, Web restart is bounded with backoff, the
  packaged archive rejects every SQLite extension, and the dev supervisor reaps
  its services when a rejection escapes.
- **Web/Admin UI**: duplicate Core reads per request were removed, the theme
  has one source of truth, modals trap and restore focus, admin list rows are
  keyboard-operable, and the dirty guard covers every workspace and page
  unload.
- **Render**: footnote numbering and anchors, callout spacing, and
  post-hydration image resolution.

### Removed

- Legacy schema migrations, replaced by a versioned migration set that refuses
  to open a database newer than the binary.
- Unused cache helpers and the pre-single-table content resources.
