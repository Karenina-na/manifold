# Contributing to Manifold

## Development setup

Install Node.js, pnpm, and Go 1.22 or newer. Then run:

```bash
pnpm install
cp .env.example .env
```

Run the Core API with `make core-run`. Run the TypeScript applications with their workspace `dev` commands.

## Change boundaries

- Core owns REST semantics and SQLite persistence.
- Contracts owns types crossing the HTTP boundary.
- SDK owns TypeScript transport behavior.
- Web and Admin consume the SDK rather than duplicating fetch logic.

Keep commits focused on one logical change. Database schema changes must include the corresponding query or migration update. Public API changes must update `docs/api-spec.md` and the shared contracts in the same change.

## Verification

Before opening a change, run:

```bash
make test
make check
```

For frontend-only changes, also run the affected workspace build and lint command.

