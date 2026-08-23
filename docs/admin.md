# Admin MVP Contract

## Module Contract

Status: [DONE]

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

Access model: Admin serves the single owner account only. It does not expose registration or multi-user onboarding; Core remains the authority for the `admin` role.

## Feature Matrix

- [x] [P0] Admin login/session | 验收标准：表单校验后调用 Core 登录，保存 JWT，错误凭据和过期状态有明确反馈。
- [x] [P0] Dashboard aggregate view | 验收标准：从 `/api/v1/admin/stats` 获取指标，展示内容总量、分类数量、待审评论和趋势图。
- [x] [P0] Content list/filter | 验收标准：展示草稿/已发布内容，支持 kind 和状态筛选，筛选参数交给 Core 服务端执行，数据来自 Core。
- [x] [P0] Content editor | 验收标准：使用 React Hook Form + Zod 编辑标题、摘要、正文、标签和 kind。
- [x] [P0] Managed UI controls | 验收标准：登录、内容编辑、Now、Settings 和审核动作使用 Mantine 的输入、选择、反馈、按钮和图标动作组件，不自行实现复杂控件。
- [x] [P0] Content lifecycle actions | 验收标准：创建、更新、发布、取消发布和删除动作均调用对应 Admin API，并刷新缓存。
- [x] [P0] Comment moderation | 验收标准：查看待审评论并 approve/reject，操作后队列和统计自动失效。
- [x] [P0] Now editor | 验收标准：管理员可更新当前状态标题、详情和 mood。
- [x] [P1] Profile/site/project configuration | 验收标准：Settings 页面通过 SDK 读取并更新 Profile、Site composition 和 Projects，服务端返回结构化校验错误。
- [x] [P1] RBAC-aware UI | 验收标准：依据 Core 返回的角色隐藏无权限动作，服务端仍负责最终拒绝。当前单角色 Admin MVP 不显示额外角色动作。
- [x] [P1] Responsive management shell | 验收标准：移动端可完成审核和发布，桌面端提供侧栏、表格和详情布局。
- [x] [P1] Workspace code splitting | 验收标准：认证壳同步加载，Dashboard、Content、Comments、Now 和 Settings 按视图懒加载，生产构建生成独立工作区 chunk。
- [x] [P1] Browser integration test | 验收标准：`pnpm browser-test` 自动启动隔离临时服务，真实浏览器完成反应 `200`、评论 `201`、登录/查询 `200`、审核 `204`，队列更新为 `0 pending`，控制台无错误，并清理测试数据。
- [x] [P1] Error capture and recovery | 验收标准：应用渲染异常由全局 Error Boundary 捕获，记录结构化错误和 trace reference，提供 workspace reload 恢复入口且不显示内部堆栈。

## State Flow

Session: `[DONE]` for the MVP login shell; automatic runtime expiry handling is a future extension; `logged out` -> `logging in` -> `authenticated` -> `expired`.

Content actions: `DRAFT` -> `PUBLISHED` -> `DRAFT` or `DELETED`.

Configuration actions: `Profile/Site/Project` -> validated Admin write -> Core persistence -> query invalidation -> refreshed Settings view.

Comment actions: `PENDING` -> `APPROVED` or `REJECTED`.

## Selected Components

- `[DONE]` Vite + React 19 as the independent shell.
- `[DONE]` TanStack Query for server state, retries, cache invalidation, and mutations.
- `[DONE]` React Hook Form + Zod + `@hookform/resolvers` for forms.
- `[DONE]` Recharts for line/bar/pie dashboard charts; no hand-drawn Canvas/SVG charts.
- `[DONE]` Lucide React for compact action icons and tooltips.
- `[DONE]` Mantine 9 for accessible management controls, validation feedback, loading buttons, selects, checkboxes, badges, and action icons.
- `[DONE]` React lazy/Suspense for view-level code splitting so the mobile-first shell does not synchronously load every workspace and chart.
- `[DONE]` `vite-plugin-pwa` for an installable Admin shell.
- `[DONE]` Root `browser-install`/`browser-test` commands for an isolated Web -> Admin acceptance flow with HTTP status, zero-row, console-error, and cleanup assertions.

## Iteration Guide

Future extensions: fine-grained roles and permissions, audit-log filtering/export, bulk publishing and scheduling, and CI enforcement for the full quality gate.

## Completion Standard

Admin MVP is complete only when every Feature Matrix checkbox is `- [x]`, every feature status is `[DONE]`, and TypeScript, production build, and browser integration checks pass.
