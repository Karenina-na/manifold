# Web Home Example Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the public home page with `1.html`, add a useful ten-item update timeline, and remove responsive overlap from content, contact, and footer areas.

**Architecture:** Keep the home page as a dynamic Server Component and continue sourcing all content from Core through the SDK. Fetch enough published content for both the visible Recent Content columns and a ten-item update rail; calculate month bands on the server and expose hover/focus previews with semantic links and CSS.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, Canvas 2D, Lucide React, Playwright browser acceptance checks.

---

### Task 1: Home acceptance coverage

**Files:**
- Modify: `scripts/browser-check.cjs`

- [x] Add desktop assertions for the example-aligned home sections, update-node count, month ticks, and update previews.
- [x] Add mobile overflow assertions for the home page, contact strip, and footer.
- [x] Run `pnpm browser-test` and confirm the acceptance assertions pass against the aligned markup.

### Task 2: Core-backed update timeline

**Files:**
- Modify: `app/web/lib/api.ts`
- Modify: `app/web/app/page.tsx`
- Modify: `app/web/app/site.module.css`

- [x] Increase the two home feed reads so their merged result can supply ten recent content updates.
- [x] Keep three items per Recent Content column while taking the newest ten merged content items for Updates.
- [x] Build equal-width month bands, position updates proportionally within their month, and render title, excerpt, type, and date previews on hover and keyboard focus.
- [x] Replace numbered timeline pins with unobstructed dots and preserve meaningful visible numbering in metadata.

### Task 3: Series, contact, and responsive polish

**Files:**
- Modify: `app/web/app/page.tsx`
- Modify: `app/web/app/site.module.css`
- Modify: `app/web/components/site-footer.tsx`
- Modify: `app/web/app/globals.css`

- [x] Present the profile collection under the `My Series` heading as concise indexed entries with category, description, URL, and external-link affordance.
- [x] Recompose Contact as a stable invitation plus wrapping public links, with explicit empty state.
- [x] Make footer rows wrap without collision and keep the particle canvas visually aligned with the example in both themes and reduced-motion mode.

### Task 4: Documentation and verification

**Files:**
- Modify: `app/web/README.md`
- Modify: `docs/decisions/web.md`
- Modify: `docs/web.md`

- [x] Document the ten-item content update timeline, equal month bands, previews, and revised home section names.
- [x] Run Web typecheck, lint, build, browser acceptance, and `git diff --check`. The repository has no separate design-system check command.
- [x] Inspect desktop and mobile browser states for clipping, overlap, blank canvas output, and hover behavior through the acceptance checks.
