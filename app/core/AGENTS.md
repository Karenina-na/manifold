# Core Agent Guide

`app/core` is the sole owner of REST semantics, business rules, SQLite persistence, authentication, caching, audit events, and anchoring behavior. Read the repository [`AGENTS.md`](../../AGENTS.md), [`docs/core.md`](../../docs/core.md), and [`docs/chain.md`](../../docs/chain.md) before changing Core.

Keep handlers, application services, domain models, stores, external integrations, and host telemetry separated by responsibility. GitHub API transport belongs in `internal/github`; host resource sampling belongs in `internal/system`. New database write paths must be recorded in the anchoring inventory or classified as an existing exception in `docs/chain.md`. Public API changes follow `contracts -> sdk -> core -> consumers -> docs -> tests`.

Run the affected Go tests and vet checks from `app/core`; for repository-wide changes also run the root verification commands described in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
