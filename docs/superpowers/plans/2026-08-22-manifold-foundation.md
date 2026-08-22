# Manifold Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize a buildable API-first Manifold monorepo with a Go service, shared TypeScript contracts and SDK, and Web/Admin application shells.

**Architecture:** The Go Core owns HTTP, configuration, authentication, validation, and SQLite storage. TypeScript consumers share hand-authored bootstrap contracts that match the REST specification; `tygo.yaml` establishes the future generated-contract path. The Web and Admin clients call Core only through `@manifold/sdk`.

**Tech Stack:** Go 1.22+, chi, cors, modernc SQLite, sqlc, tygo, pnpm, TypeScript, Next.js App Router, Tailwind CSS, Vite, React 19, PWA, TanStack Query, React Hook Form, Zod.

---

### Task 1: Workspace and Documentation

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `Makefile`, `.gitignore`, `.env.example`
- Create: `README.md`, `docs/architecture.md`, `docs/api-spec.md`, `docs/decisions/ADR-001-api-first-monorepo.md`

- [ ] Define pnpm workspace membership and root commands for development, builds, linting, testing, contract generation, and database generation.
- [ ] Document the module boundaries, REST error envelope, and the choice of SQLite plus generated contracts.
- [ ] Verify workspace discovery with `pnpm --filter @manifold/contracts exec tsc --version` after dependencies are installed.

### Task 2: Core API Foundation

**Files:**
- Create: `apps/core/go.mod`, `apps/core/cmd/server/main.go`
- Create: `apps/core/internal/config/config.go`, `apps/core/internal/handler/health.go`, `apps/core/internal/handler/response.go`
- Create: `apps/core/internal/middleware/auth.go`, `apps/core/internal/middleware/logging.go`, `apps/core/internal/model/*.go`, `apps/core/internal/store/store.go`
- Create: `apps/core/db/schema.sql`, `apps/core/db/queries.sql`, `apps/core/sqlc.yaml`, `apps/core/tygo.yaml`

- [ ] Add a failing `httptest` asserting `GET /healthz` returns `{"status":"ok"}`.
- [ ] Implement configuration validation, router setup, CORS, logging, optional bearer authentication, SQLite initialization, and the health route.
- [ ] Add domain model types and initial DDL/query definitions for profiles, content entries, and current status.
- [ ] Run `go test ./...` and `go vet ./...`.

### Task 3: Shared Contracts and SDK

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/src/index.ts`, `packages/sdk/src/index.test.ts`

- [ ] Add a failing SDK test that stubs `fetch` and expects non-2xx responses to throw `ApiError`.
- [ ] Define shared response, error, profile, entry, and now-status types.
- [ ] Implement the fetch-based client and expose health, profile, entries, and now-status methods.
- [ ] Run SDK tests and TypeScript checks.

### Task 4: Web Application Shell

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`
- Create: `apps/web/components/command-menu.tsx`, `apps/web/components/now-beacon.tsx`

- [ ] Build a responsive thought-stream home page using the local design token contract.
- [ ] Add a keyboard-accessible command menu and a server-side Core health probe with an offline-safe fallback.
- [ ] Run `pnpm --filter @manifold/web build`.

### Task 5: Admin PWA Shell

**Files:**
- Create: `apps/admin/package.json`, `apps/admin/tsconfig.json`, `apps/admin/vite.config.ts`, `apps/admin/index.html`
- Create: `apps/admin/src/main.tsx`, `apps/admin/src/app.tsx`, `apps/admin/src/styles.css`, `apps/admin/src/vite-env.d.ts`

- [ ] Build the mobile-first administration shell with a validated quick-entry form.
- [ ] Configure the PWA manifest and service worker generation.
- [ ] Run `pnpm --filter @manifold/admin build`.

### Task 6: Cross-Workspace Verification

**Files:**
- Modify: `Makefile`, `README.md` if verification commands differ from actual tool output.

- [ ] Run formatting, Go tests, TypeScript package checks, and production builds.
- [ ] Inspect the resulting workspace file list and report unavailable optional generators (`sqlc`, `tygo`) separately from compilation results.
