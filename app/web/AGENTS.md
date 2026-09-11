<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Web Agent Guide

Read the repository [`AGENTS.md`](../../AGENTS.md), [`docs/web.md`](../../docs/web.md), [`docs/decisions/web.md`](../../docs/decisions/web.md), [`packages/contracts/README.md`](../../packages/contracts/README.md), and [`packages/sdk/README.md`](../../packages/sdk/README.md) before changing this workspace.

- `app/` contains routes and Server Components.
- `components/` contains reusable UI components.
- `features/` contains client state for a single interaction domain.
- `lib/` contains UI-independent helpers and the Core client entry point.
- Core is accessed only through `@manifold/sdk`; Web must not duplicate Core publication, statistics, permission, or pagination rules.
- Shared Markdown/content rendering belongs in `packages/render`. Keep sanitization at the rendering boundary and preserve Server/Client Component boundaries.

Run the Web typecheck, lint, test, and build commands for Web changes, plus `pnpm browser-test` when browser behavior or cross-workspace integration changes.
