# Web Home Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the public Web home page with a calm digital-garden layout, frosted centered navigation, and usable search/theme/utility interactions.

**Architecture:** Keep Core as the source of profile, now, stats, and content data. Add a small client-only navigation/search surface at the layout boundary; keep the home page as a dynamic Server Component and adapt its existing Core-backed data into the requested hero, journey, now, and recent-stream sections.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, Lucide React, `@manifold/sdk`.

---

### Task 1: Global navigation surface

**Files:**
- Modify: `app/web/components/site-nav.tsx`
- Modify: `app/web/app/site.module.css`
- Modify: `app/web/app/globals.css`

- [x] Add route-aware Home/Writings/Thoughts pills, identity reset behavior, responsive overflow, and utility icon buttons.
- [x] Add a command-search dialog that queries both content kinds through the existing SDK and exposes the profile resume link when available.
- [x] Add a client theme toggle with persisted preference and a dark neutral token override.
- [ ] Run `pnpm --filter @manifold/web typecheck` and `pnpm --filter @manifold/web lint`.

### Task 2: Digital-garden home composition

**Files:**
- Modify: `app/web/app/page.tsx`
- Modify: `app/web/app/site.module.css`

- [x] Recompose the existing Core data into hero identity, social links, journey, optional Now panel, selected writings, and latest thoughts.
- [x] Preserve error/empty states and existing hrefs from Core.
- [x] Add responsive single-column layout and subtle hover/fade motion consistent with design tokens.
- [ ] Run the Web typecheck and lint again.

### Task 3: Contract documentation and runtime verification

**Files:**
- Modify: `docs/decisions/web.md`
- Modify: `docs/web.md`

- [x] Document the new home structure and navigation/search/theme behavior without changing the API contract.
- [x] Run Web build and browser checks at desktop and mobile widths, including search, theme, and nav interactions.
- [x] Run `git diff --check` and report any remaining unrelated workspace state.
