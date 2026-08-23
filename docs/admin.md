# Admin MVP Contract

## Module Contract

Status: [WIP]

`app/admin` is an independently deployable management and analytics application. It has no dependency on Web components, routes, or state. It calls only private Core endpoints through `@manifold/sdk` and never reads the Core SQLite file.

Inputs:

- Core Admin API base URL from `VITE_CORE_URL`.
- Admin JWT stored by the SDK session layer.
- Content, moderation, now-status, and aggregate statistics responses.

Outputs:

- Login and session expiry states.
- Content management workspace with explicit draft/publish transitions.
- Comment moderation queue.
- Now-status editor.
- Dashboard cards and charts based on Core-provided aggregates; no frontend re-computation of business metrics.

## Feature Matrix

- [x] [P0] Admin login/session | 验收标准：表单校验后调用 Core 登录，保存 JWT，错误凭据和过期状态有明确反馈。
- [x] [P0] Dashboard aggregate view | 验收标准：从 `/api/v1/admin/stats` 获取指标，展示内容总量、分类数量、待审评论和趋势图。
- [x] [P0] Content list/filter | 验收标准：展示草稿/已发布内容，支持 kind 和状态筛选，筛选参数交给 Core 服务端执行，数据来自 Core。
- [x] [P0] Content editor | 验收标准：使用 React Hook Form + Zod 编辑标题、摘要、正文、标签和 kind。
- [x] [P0] Content lifecycle actions | 验收标准：创建、更新、发布、取消发布和删除动作均调用对应 Admin API，并刷新缓存。
- [x] [P0] Comment moderation | 验收标准：查看待审评论并 approve/reject，操作后队列和统计自动失效。
- [x] [P0] Now editor | 验收标准：管理员可更新当前状态标题、详情和 mood。
- [x] [P1] RBAC-aware UI | 验收标准：依据 Core 返回的角色隐藏无权限动作，服务端仍负责最终拒绝。当前单角色 Admin MVP 不显示额外角色动作。
- [x] [P1] Responsive management shell | 验收标准：移动端可完成审核和发布，桌面端提供侧栏、表格和详情布局。
- [ ] [P1] Browser integration test | 验收标准：真实浏览器可完成登录 -> 查看数据 -> 发布草稿或审核评论流程。当前受本地浏览器/服务进程环境限制，尚未宣称完成。

## State Flow

Session: `[DONE]` for the MVP login shell; automatic runtime expiry handling remains `[TODO]`; `logged out` -> `logging in` -> `authenticated` -> `expired`.

Content actions: `DRAFT` -> `PUBLISHED` -> `DRAFT` or `DELETED`.

Comment actions: `PENDING` -> `APPROVED` or `REJECTED`.

## Selected Components

- `[DONE]` Vite + React 19 as the independent shell.
- `[DONE]` TanStack Query for server state, retries, cache invalidation, and mutations.
- `[DONE]` React Hook Form + Zod + `@hookform/resolvers` for forms.
- `[DONE]` Recharts for line/bar/pie dashboard charts; no hand-drawn Canvas/SVG charts.
- `[DONE]` Lucide React for compact action icons and tooltips.
- `[DONE]` `vite-plugin-pwa` for an installable Admin shell.

## Iteration Guide

1. `[TODO]` Add fine-grained roles and permissions after the single-admin MVP is proven.
2. `[TODO]` Add audit-log filtering, export, and operator activity views.
3. `[TODO]` Add bulk publishing and scheduled content workflows.
4. `[TODO]` Add CI enforcement for docs checkboxes, type checks, tests, lint, and production builds.

## Completion Standard

Admin MVP is complete only when every Feature Matrix checkbox is `- [x]`, every feature status is `[DONE]`, and TypeScript, production build, and browser integration checks pass.
