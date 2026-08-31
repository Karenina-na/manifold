# @manifold/render

公开内容渲染的唯一来源（single source of truth），被 `app/web`（公开阅读端）与 `app/admin`（Render 预览 Tab）共同消费。

## 导出

| 导出 | 用途 |
| --- | --- |
| `MarkdownContent` | Markdown 正文渲染：GFM、数学公式（KaTeX）、代码高亮、sanitize、标题锚点（`data-content-heading`）、CodeBlock 复制按钮、图片块级展示（显式 sanitize schema 允许 `img`，组件注入 `loading="lazy" decoding="async"`，`render.css` 提供边框圆角与自适应宽度） |
| `ArticleToc` / `ReadingProgress` | TOC 侧栏（scrollspy + 进度）与阅读进度轨 |
| `ReadingShell` | 长文阅读三栏网格骨架；web 通过 `rail/discussion/composer` slots 注入评论编排，admin 只传正文与 TOC。未传 `rail` 时自动切到 `no-rail` 网格（正文列 + TOC，无预留 rail 列） |
| `ArticleSurface` / `ThoughtSurface` / `ThoughtHeader` / `ThoughtBody` | 文章与 Thought 的详情面组成件（标题块、meta 行、溯源组） |
| `formatDate` | 详情面统一的日期格式 |

## 样式契约

`src/render.css` 使用普通类名（非 CSS Module），同时携带 `--mdr-*` 设计 token，默认值即 web 浅色主题的文章排版值：

- **web**：在 `globals.css` 用 `html:root { --mdr-accent: var(--color-accent); … }` 绑定到自己的主题 token（深色主题自动生效）。
- **admin**：直接使用默认值，Render Tab 与 web 视觉一致。

## 同步规则（必须遵守）

> **渲染表现的修改只允许发生在本包**。任何一端不得复制或 fork 这里的组件/样式/类名。
> 修改 `src/` 下任何文件后，必须同时验证两端：
>
> 1. `pnpm --filter @manifold/web test && pnpm --filter @manifold/web build`
> 2. `pnpm --filter @manifold/admin build && pnpm browser-test`
>
> 新增类名时，确认 `render.css` 与组件 JSX 同步；删除 web/admin 侧遗留的平行样式（如 `site.module.css`、`App.css`）而非留着双份。

## 依赖说明

- `react-markdown` + remark/rehype 插件栈与 web 原实现完全一致；`rehype-sanitize` 保证 Markdown 的 HTML 输出安全（Core 存储不承诺 HTML 安全，清洗发生在渲染边界）。
- `lucide-react` 用于 meta 行与 CodeBlock 图标；`katex` 样式由消费端引入（web 在 `globals.css`，admin 在 `main.tsx`）。
