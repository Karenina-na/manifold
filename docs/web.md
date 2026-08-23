# Web MVP Contract

## Module Contract

Status: [WIP]

`app/web` is the public reading and interaction application. It is independently deployable, has no import or runtime dependency on `app/admin`, and communicates with Core only through `@manifold/sdk` over HTTP.

Inputs:

- Public Core API responses from `NEXT_PUBLIC_CORE_URL`.
- URL route state for content slugs.
- Reader input for comments.

Outputs:

- SEO-friendly home, content list, content detail, project, and current-status views.
- Sanitized Markdown rendering.
- Optimistic comment submission state with a pending confirmation.
- Responsive layout following the existing Yohaku tokens without creating a second design system.

## Feature Matrix

- [x] [P0] Public home composition | 验收标准：首屏展示 profile、now、feed、projects 和 stats，并在 Core 不可用时显示可理解的错误状态。
- [x] [P0] Content stream | 验收标准：列表显示 kind、标题、摘要、标签和发布时间，可进入详情。
- [x] [P0] Content detail reading | 验收标准：按 slug 加载正文，使用 `react-markdown` + `rehype-sanitize`，不直接注入未处理 HTML。
- [x] [P0] SEO metadata | 验收标准：首页和详情页输出稳定 title、description、canonical metadata。
- [x] [P0] Comment list | 验收标准：详情页只展示 Core 返回的 approved 评论，空态和加载态可见。
- [x] [P0] Comment form | 验收标准：使用 React Hook Form + Zod 校验，提交采用乐观 UI，失败可恢复且不丢输入。
- [x] [P1] Reading navigation | 验收标准：提供返回流、上一篇/下一篇的可扩展入口，移动端不遮挡正文。
- [x] [P1] Responsive/accessibility pass | 验收标准：移动和桌面视口无重叠，交互控件有可访问名称，键盘可完成评论提交。
- [ ] [P1] Browser integration test | 验收标准：真实浏览器可完成首页 -> 详情 -> 评论提交流程，控制台无错误。当前受本地浏览器/服务进程环境限制，尚未宣称完成。

## State Flow

Page data: `[DONE]`; browser integration remains `[TODO]`.

Comment UI: `idle` -> `submitting` -> `pending moderation` or `error`; the server remains the source of truth.

## Selected Components

- `[DONE]` Next.js App Router for SSR/SEO and route-level loading boundaries.
- `[DONE]` TanStack Query for cache, retries, and invalidation around the SDK.
- `[DONE]` React Hook Form + Zod for declarative comment validation.
- `[DONE]` `react-markdown` + `rehype-sanitize` for safe Markdown rendering.
- `[DONE]` Lucide React for interface icons and Framer Motion only for restrained state transitions.

## Iteration Guide

1. `[TODO]` Add full-text search and command navigation after Core search is stable.
2. `[TODO]` Add image/media attachments through a dedicated Core asset API.
3. `[TODO]` Add offline-friendly reading cache and progressively enhanced PWA behavior.
4. `[TODO]` Add analytics/error capture without collecting unnecessary reader data.

## Completion Standard

Web MVP is complete only when every Feature Matrix checkbox is `- [x]`, every feature status is `[DONE]`, and TypeScript, production build, and browser integration checks pass.
