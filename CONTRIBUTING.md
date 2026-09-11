# Contributing to Manifold

## Development setup

Install Node.js `>=20.9`, pnpm `11.19.0`, and Go `>=1.26.5`. Then run:

```bash
pnpm install
cp .env.example .env
```

Run the Core API with `make core-run`. Run the TypeScript applications with their workspace `dev` commands. Core automatically loads the nearest `.env` (walking up from its working directory, so the repository-root file applies); existing environment variables take precedence.

## Change boundaries

- Core owns REST semantics and SQLite persistence.
- Contracts owns types crossing the HTTP boundary.
- SDK owns TypeScript transport behavior.
- Web and Admin consume the SDK rather than duplicating fetch logic.
- Render owns shared Markdown/content rendering; Web and Admin must not fork its components or styles.

Keep commits focused on one logical change. Database schema changes must include the corresponding query or migration update. Public API changes must update `docs/core.md` and the shared contracts in the same change. Follow `contracts -> sdk -> core -> web/admin -> docs -> tests` for cross-workspace API changes. Any new database write path must be registered in `docs/chain.md` or explicitly classified as an existing exception.

## Verification

Before opening a change, run:

```bash
make test
make check
pnpm build
pnpm browser-test
git diff --check
```

For frontend-only changes, also run the affected workspace build and lint command. Use Conventional Commits, for example `feat(core): add content endpoint` or `docs: align sdk contract`.
