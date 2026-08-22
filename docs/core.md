# Core MVP Contract

## Module Contract

Status: [WIP]

`app/core` is the only service that owns business persistence. It exposes REST/JSON over HTTP, keeps SQLite private, validates boundary input, issues signed JWTs, enforces the `admin` role with Casbin, records moderation state, and provides aggregated statistics.

Inputs:

- Public HTTP requests from `app/web` or other public clients.
- Authenticated Admin HTTP requests from `app/admin`.
- Environment configuration: `CORE_ADDR`, `CORE_DATABASE_PATH`, `CORE_ALLOWED_ORIGINS`, `CORE_JWT_SECRET`, `CORE_ADMIN_USERNAME`, and `CORE_ADMIN_PASSWORD_HASH`.

Outputs:

- Public API under `/api/v1` for profile, site, feed, content, projects, now, stats, comments, and health.
- Private API under `/api/v1/admin` for session, content lifecycle, now editing, comment moderation, and Admin statistics.
- JSON errors with `error.code`, `error.message`, and `error.requestId`.

Isolation rules:

- No Web or Admin package imports Core Go code.
- No frontend reads or writes the SQLite file.
- Shared TypeScript types travel through `packages/contracts`; HTTP calls travel through `packages/sdk`.

## Feature Matrix

- [x] [P0] SQLite schema and seed data | 验收标准：Core 启动时自动创建 profile、content、projects、now_status、comments 表并可重复启动。
- [x] [P0] Health endpoint | 验收标准：`GET /healthz` 返回状态和版本，且不暴露数据库细节。
- [x] [P0] Public profile/site/now APIs | 验收标准：Web 可通过 HTTP 获取个人资料、首页引用和当前状态。
- [x] [P0] Public content/feed APIs | 验收标准：仅返回已发布内容，列表不包含正文，详情按 slug 返回 Markdown 正文。
- [x] [P0] Projects and aggregated stats APIs | 验收标准：项目列表和统计由 Core 聚合后返回，客户端不重算核心指标。
- [x] [P0] Public comment submission | 验收标准：评论经过声明式校验后进入 `PENDING`，公开列表只返回 `APPROVED`。
- [x] [P0] JWT Admin session | 验收标准：正确的用户名/密码签发带过期时间的 JWT，错误凭据返回 401。
- [x] [P0] Casbin role protection | 验收标准：`admin` 路由必须携带有效 JWT 且角色为 `admin`，越权返回 401/403。
- [x] [P0] Admin content lifecycle | 验收标准：Admin 可创建、编辑、发布、取消发布和软删除内容。
- [x] [P0] Admin comment moderation | 验收标准：Admin 可查看待审评论并 approve/reject，状态改变后公开 API 行为正确。
- [ ] [P1] Structured request logging and audit events | 验收标准：关键写操作输出结构化日志并记录事件名称、资源 ID、操作者和时间。
- [x] [P1] API contract regression tests | 验收标准：异常输入、未授权、未找到、发布状态和评论审核路径均有自动化测试。

## API Contract

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | public | liveness |
| GET | `/api/v1/profile` | public | identity |
| GET | `/api/v1/site` | public | homepage composition |
| GET | `/api/v1/feed` | public | compact published stream |
| GET | `/api/v1/stats` | public | public aggregate stats |
| GET | `/api/v1/content` | public | published list |
| GET | `/api/v1/content/:slug` | public | published detail |
| GET/POST | `/api/v1/content/:slug/comments` | public | approved comments / pending submission |
| GET | `/api/v1/projects` | public | curated projects |
| GET | `/api/v1/now` | public | current focus |
| POST | `/api/v1/admin/session` | public | JWT login |
| GET/POST/PATCH/DELETE | `/api/v1/admin/content` | admin | content management |
| POST | `/api/v1/admin/content/:id/publish` | admin | publish transition |
| POST | `/api/v1/admin/content/:id/unpublish` | admin | unpublish transition |
| GET/POST | `/api/v1/admin/comments` | admin | moderation queue |
| POST | `/api/v1/admin/comments/:id/approve` | admin | approve comment |
| POST | `/api/v1/admin/comments/:id/reject` | admin | reject comment |
| GET/PUT | `/api/v1/admin/now` | admin | edit current focus |
| GET | `/api/v1/admin/stats` | admin | dashboard aggregate |

Collections use `{ data, pagination: { nextCursor, hasMore } }`; the MVP may return `nextCursor: null` and `hasMore: false` while the dataset is small. Public errors are stable JSON envelopes.

## State Flow

`[TODO]` -> `[WIP]` -> `[DONE]` is the only allowed delivery flow. A feature is `[DONE]` only after implementation, automated test, and this checklist update are in the same reviewed change.

Content: `DRAFT` -> `PUBLISHED` -> `DRAFT`; deletion moves any state to `DELETED` and removes the item from public reads.

Comment: `PENDING` -> `APPROVED` or `REJECTED`; only `APPROVED` is public.

Admin session: credentials -> signed JWT -> validated role -> protected request.

## Iteration Guide

1. `[TODO]` Observability: add request/trace IDs across Core, Web, and Admin; export structured errors to an error monitor.
2. `[TODO]` Performance: add read-through caching for published content and precomputed Admin statistics.
3. `[TODO]` Decoupling: publish comment moderation, analytics, and notifications as asynchronous domain events.
4. `[TODO]` Governance: run Go/TypeScript lint, tests, docs checklist validation, and container builds in CI.

## Completion Standard

Core MVP is complete only when every Feature Matrix checkbox is `- [x]`, every feature status is `[DONE]`, and `go test ./...`, `go vet ./...`, and the API integration suite pass.
