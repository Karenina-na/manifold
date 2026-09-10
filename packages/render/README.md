# @manifold/render

公开内容渲染的唯一来源（single source of truth），被 `app/web`（公开阅读端）与 `app/admin`（Render 预览 Tab）共同消费。

## 导出

| 导出 | 用途 |
| --- | --- |
| `MarkdownContent` | Markdown 正文渲染：GFM（含 `> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` callout 卡片、脚注——引用为胶囊徽标 + hover 悬浮卡，定义收拢为文末虚线卡片）、数学公式（KaTeX）、代码高亮（`language-diff` 行级增删着色、编程连字）、sanitize、标题锚点（`data-content-heading`）、CodeBlock 复制按钮、图片块级展示（显式 sanitize schema 允许 `img`，组件注入 `loading="lazy" decoding="async"` 与渐进模糊加载 `mdrImgLoading`→`mdrImgLoaded`）、表格智能溢出遮罩（仅溢出时显示右缘渐变、滚到底自动消隐）、空单元格占位、行内 `<kbd>`/`<mark>` 等有限 HTML 经 `rehype-raw` 解析后由 `rehype-sanitize` 最终清洗；结构块（代码/表格/图）相对正文测量向外穿透 36px（≤900px 视口还原为通栏） |
| `CommentMarkdown` | 评论正文轻量 Markdown：GFM + 软换行（`remark-breaks`，单次 Enter 即换行）、sanitize（schema 移除标题与 `img`，评论不得注入标题大纲或外链图片）、无代码工具栏/KaTeX/目录机制 |
| `ArticleToc` / `ReadingProgress` | TOC 侧栏（scrollspy + 进度）与阅读进度轨 |
| `ReadingShell` | 长文阅读三栏网格骨架；web 通过 `rail/discussion/composer` slots 注入评论编排，admin 只传正文与 TOC。未传 `rail` 时自动切到 `no-rail` 网格（正文列 + TOC，无预留 rail 列） |
| `ArticleSurface` / `ThoughtSurface` / `ThoughtHeader` / `ThoughtBody` | 文章与 Thought 的详情面组成件（标题块、meta 行、溯源组）；`ThoughtHeader`/`ThoughtSurface` 的 `meta` slot 在 meta 行行尾追加调用方内容（web 用于锚定徽标） |
| `formatDate` | 详情面统一的日期格式 |

## 样式契约

`src/render.css` 使用普通类名（非 CSS Module），同时携带 `--mdr-*` 设计 token，默认值即 web 浅色主题的文章排版值。代码块为**双模式**：`:root` 默认暖纸浅底（`--mdr-code-bg: #f4f3ee` 等），web 暗色主题在 `globals.css` 以 `--mdr-code-*` 变量映射为深底语法色：

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

- `react-markdown` + remark/rehype 插件栈与 web 原实现完全一致；`rehype-sanitize` 保证 Markdown 的 HTML 输出安全（Core 存储不承诺 HTML 安全，清洗发生在渲染边界）。`rehype-raw`（配合 `remarkRehypeOptions.allowDangerousHtml`）允许有限原始 HTML（`kbd`/`mark` 等），其输出仍经过 `rehype-sanitize` 兜底；sanitize schema 额外放行 `mark` 标签与 `sup`/`span`/`blockquote` 的 `className`（callout 语义类与脚注浮窗样式），`data-*` 一律不放行。callout 与脚注在 **mdast 层插件**（`remarkCallouts`/`remarkFootnotes`）处理：callout 在解析期剥离标签文本并挂语义类；脚注把引用改写为带 popover 的 `<sup>` 并把定义收拢成文末 `<section data-footnotes>`，生成 HTML 走同一 raw→sanitize 管线。
- `remark-breaks`（约 2KB，无运行时依赖）仅用于 `CommentMarkdown`：评论在普通 textarea 中输入，单换行渲染为 `<br>` 符合输入直觉；替代方案是在渲染前把单换行改写为段落（间距过大）或不处理（存量多行评论会被并成一行），均不采用。
- `lucide-react` 用于 meta 行与 CodeBlock 图标；`katex` 样式由消费端引入（web 在 `globals.css`，admin 在 `main.tsx`）。
