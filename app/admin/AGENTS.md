# Admin Agent Guide

Read the repository [`AGENTS.md`](../../AGENTS.md), [`docs/admin.md`](../../docs/admin.md), [`packages/contracts/README.md`](../../packages/contracts/README.md), and [`packages/sdk/README.md`](../../packages/sdk/README.md) before changing this workspace.

- `src/workspaces/` contains workspace pages and their local state.
- `src/components/` contains components shared across workspaces.
- `src/lib/` contains UI-independent helpers and hooks.
- Core is accessed only through `@manifold/sdk`; Admin must not read SQLite or duplicate Core business rules.
- Shared Markdown/content rendering belongs in `packages/render`.

Run the Admin typecheck, lint, build, and the relevant root checks for changes that cross workspace boundaries.
