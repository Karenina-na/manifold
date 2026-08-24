# Web MVP Contract

> Scope note: The current Web MVP exposes the homepage and the `TECH`, `THOUGHT`, and `MANUSCRIPT` archive/detail views. The earlier project view described below is historical planning context and is not an active route.

## Module Contract

Status: [DONE]

`app/web` is the public reading and interaction application. It is independently deployable, has no import or runtime dependency on `app/admin`, and communicates with Core only through `@manifold/sdk` over HTTP.

Inputs:

- Public Core API responses from `NEXT_PUBLIC_CORE_URL`.
- URL route state for content slugs.
- Reader input for comments; the display name and website are optional.
- A locally generated `X-Visitor-ID` persisted in browser storage for reactions.

Outputs:

- SEO-friendly home, content list, content detail, project, and current-status views.
- Sanitized Markdown rendering.
- Optimistic comment submission state with a pending confirmation.
- Optimistic `LIKE` and `FAVORITE` state with server reconciliation and rollback on failure.
- Responsive layout following the existing Yohaku tokens without creating a second design system.

Access model: all public reads and visitor reactions/comments are available without registration; the only identity state held by Web is the anonymous visitor identifier used to scope reactions.

## Feature Matrix

- [x] [P0] Public home composition | 验收标准：首屏展示 profile、now、feed、projects 和 stats，并在 Core 不可用时显示可理解的错误状态。
- [x] [P0] Content stream | 验收标准：列表显示 kind、标题、摘要、标签和发布时间，可进入详情。
- [x] [P0] Content detail reading | 验收标准：按 slug 加载正文，使用 `react-markdown` + `rehype-sanitize`，不直接注入未处理 HTML。
- [x] [P0] SEO metadata | 验收标准：首页和详情页输出稳定 title、description、canonical metadata。
- [x] [P0] Comment list | 验收标准：详情页只展示 Core 返回的 approved 评论，空态和加载态可见。
- [x] [P0] Comment form | 验收标准：使用 React Hook Form + Zod 校验，正文必填、昵称和网站可选，提交采用乐观 UI，失败可恢复且不丢输入。
- [x] [P0] Component primitives | 验收标准：评论表单和反应条使用 Radix Themes 的可访问输入、文本域和按钮组件，状态仍由现有 React Hook Form 与 React Query 管理。
- [x] [P0] Reaction bar | 验收标准：详情页可读取并乐观更新点赞/收藏，SDK 通过 `X-Visitor-ID` 调用 Core，成功后以服务端摘要校正状态。
- [x] [P1] Reading navigation | 验收标准：提供返回流、上一篇/下一篇的可扩展入口，移动端不遮挡正文。
- [x] [P1] Responsive/accessibility pass | 验收标准：移动和桌面视口无重叠，交互控件有可访问名称，键盘可完成评论提交。
- [x] [P1] Browser integration test | 验收标准：真实浏览器完成详情 -> 点赞 -> 收藏 -> 评论提交流程，Core 请求分别返回 `200/201`，页面显示 `Awaiting review`，控制台无错误。
- [x] [P1] Error capture and recovery | 验收标准：路由级和全局渲染异常进入可恢复错误页，生成前端 trace reference 并记录结构化错误，不泄漏内部堆栈。

## State Flow

Page data: `[DONE]`; reaction state: `[DONE]`; browser integration: `[DONE]`.

Comment UI: `idle` -> `submitting` -> `pending moderation` or `error`; the server remains the source of truth.

## Selected Components

- `[DONE]` Next.js App Router for SSR/SEO and route-level loading boundaries.
- `[DONE]` TanStack Query for cache, retries, and invalidation around the SDK.
- `[DONE]` React Hook Form + Zod for declarative comment validation.
- `[DONE]` `react-markdown` + `rehype-sanitize` for safe Markdown rendering.
- `[DONE]` Lucide React for interface icons and Framer Motion only for restrained state transitions.
- `[DONE]` Radix Themes for accessible Web buttons, text fields, text areas, and theme tokens; page-specific CSS remains limited to layout and reading presentation.

## Iteration Guide

Future extensions: full-text search and command navigation, image/media attachments through a dedicated Core asset API, and offline-friendly reading cache.

## Completion Standard

Web MVP is complete only when every Feature Matrix checkbox is `- [x]`, every feature status is `[DONE]`, and TypeScript, production build, and browser integration checks pass.
