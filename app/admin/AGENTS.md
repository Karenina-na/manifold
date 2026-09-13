# Admin Agent Guide

Read the repository [`AGENTS.md`](../../AGENTS.md), [`docs/admin.md`](../../docs/admin.md), [`packages/contracts/README.md`](../../packages/contracts/README.md), and [`packages/sdk/README.md`](../../packages/sdk/README.md) before changing this workspace.

- `src/workspaces/` contains workspace pages and their local state.
- `src/app/` contains the login/navigation shell and error boundary.
- `src/components/common/`, `src/components/content/`, and `src/components/forms/` contain cross-workspace UI grouped by responsibility.
- `src/features/settings/` owns the Settings page, security panel, and form schema.
- `src/i18n/` owns locale resources and formatters; `src/lib/` contains UI-independent infrastructure and hooks.
- Core is accessed only through `@manifold/sdk`; Admin must not read SQLite or duplicate Core business rules.
- Shared Markdown/content rendering belongs in `packages/render`.

Run the Admin typecheck, lint, build, and the relevant root checks for changes that cross workspace boundaries.
