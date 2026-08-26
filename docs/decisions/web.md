# Web 当前架构与 API 消费契约

> 本文记录 `app/web` 的当前实现，而不是未来页面规划。修改 Web 路由、页面数据、Core 调用、Markdown 渲染、评论/反应、SEO、可观测性或设计约束时必须同步本文。历史方案不得把 Projects、Technology、Manuscript 等已移出范围的内容写成当前功能。

## 1. 项目定位

Web 是公开阅读端，负责把 Profile、Now、Stats、Thoughts 和 Writings 组合成个人数字花园。它不持有业务数据，不读 SQLite，不导入 Admin 或 Core Go 包，所有 Core 请求都通过 `@manifold/sdk`。

运行时边界：

```text
Next Server/Browser Components
          |
          +--> @manifold/sdk --> Core /api/v1
          +--> @manifold/contracts
```

Server Component 负责首屏数据、详情读取和 SEO；Client Component 负责评论、反应、导航菜单、命令式搜索、主题偏好、错误恢复和局部状态。顶部导航固定为居中 860px 毛玻璃容器，Home/Writings/Thoughts 使用 route-aware pill；搜索通过现有 SDK 的 `feed({ q, kind })` 同时检索两类公开内容，并提供 Profile 的简历链接。主题偏好仅保存在浏览器 `localStorage`，不改变 Core 数据或公共 API。Radix Theme 根节点使用 `hasBackground={false}`，由 Web 的 `--surface-paper` 统一管理页面背景，避免第三方主题默认白色背景形成横向色带。

## 2. 页面与路由

| 路由 | 类型 | Core 数据 | 行为 |
| --- | --- | --- | --- |
| `/` | Dynamic Server Component | profile、site、全部公开 Article/Thought 历史、now、stats | Profile/Introduction、Recent Content、Updates、年度 Contribution activity、My Series、Contact |
| `/thoughts` | Dynamic Server Component | `feed({ kind: "THOUGHT" })` | 轻量时间线/标签入口 |
| `/thoughts/[id]` | Dynamic Server Component | 通过 ID 获取 Thought 详情 | 复用统一阅读器和评论/反应 |
| `/writing` | Dynamic Server Component + client archive controls | `content({ kind: "ARTICLE", limit: 100 })` | 双栏长文归档、置顶首篇、搜索、标签筛选、最新/最早/最近更新排序与 sticky 侧栏；列表展示 Core 聚合的浏览量和点赞数；从详情页通过浏览器历史返回时刷新 RSC 数据 |
| `/writing/[slug]` | Dynamic Server Component + client reading controls | `contentBySlug(slug)` | 四段同宽的不透明阅读面（标题、正文、讨论、添加评论）、同排日期/阅读时长/语言/统计、Markdown、右侧进度目录、评论和反应；讨论面展示统计、搜索和筛选，添加评论面在接近底部时由桌面/平板左侧紧凑动作卡通过共享布局动画展开，手机端在讨论面之后堆叠 |
| `/health` | Route Handler | 无 | Web 进程 liveness，Core 健康检查仍为 `/healthz` |
| `/feed.xml` | Dynamic Route Handler | profile、2 条 Article、3 条 Thought | 输出同源 RSS 2.0 feed，复用首页 feed 数据 |

详情页根据 content kind 选择返回路径：Thought 用 `/thoughts/{id}`，Article 用 `/writing/{slug}`。Core 返回的 `href` 是列表链接的来源，页面不自行重建业务 URL。

## 3. 首页数据流

`loadHomeData()` 并行调用：

```text
profile()
site()
feed({ limit: 50, kind: "ARTICLE", cursor })  // repeat until pagination ends or 1000 items
feed({ limit: 50, kind: "THOUGHT", cursor })  // repeat until pagination ends or 1000 items
now()
stats()
```

两组内容在 Web 内按 `publishedAt ?? createdAt` 倒序混排，最多保留每类 1000 条历史副本并按 `updatedAt` 提供给年度 Contribution activity；首个分页请求失败时首页显示 Core unavailable，后续历史页失败则保留已获取数据，不阻断主页。统计、发布状态和内容计数只使用 Core 返回值；Contribution activity 只在 Web 展示边界按 UTC 日期聚合更新次数，不改变 Core 统计。任一首屏请求失败时，首页显示 Core unavailable 状态，不暴露内部错误。

首页将 Profile 与 Introduction 合并为首屏画像模块，Introduction 使用不透明 surface；状态徽标使用 `now.mood`（无值时隐藏），并将 feed 在展示边界拆分为左右两列的 Writings/Thoughts 竖向时间线（各最多 3 条），保留 Core 返回的 `href`。其下展示按 `updatedAt` 倒序选取最近 10 个内容的横向 update rail：月份覆盖数据范围且等距分布，节点在对应月份区间内按日期比例定位；同一天的多个更新合并为一个日期节点，鼠标 hover 或键盘 focus 后在竖向预览中依次展示当天每条更新的标题、类型、摘要、时间和链接。Update rail 下方展示 GitHub 风格的 Contribution activity：年份下拉框切换完整年度，按 UTC 日期聚合内容 `updatedAt`，以 7 行周历网格和 0-4 级颜色表达当天更新数量，并在移动端只允许网格自身横向滚动。后续展示 Profile 的紧凑 My Series 索引卡片和纯图标 Contact rail；Series/Contact 的 hover/focus 详情由 Web Client Component 通过 `createPortal` 渲染到 `document.body`，使用视口边界夹紧和最高层级，避免被 section 动画或其他文本遮挡，并通过 `aria-describedby` 关联到对应入口。SiteFooter 使用匿名 `manifold.visitorId` 每 60 秒向 Core presence 发送心跳，展示最近 5 分钟活跃访客数，不使用 mock 数字。以上共同信息的排版参考仓库根目录 `1.html`，但内容仍以 Core 返回值为准；滚动渐显由 Web Client Component 的 IntersectionObserver 提供，不改变 Core 状态。

## 4. Markdown 阅读器

Web 和 Admin 使用相同的 Markdown 能力组合：

- `react-markdown`：React 渲染边界。
- `remark-gfm`：表格、任务列表、删除线等 GFM。
- `remark-math` + `rehype-katex` + `katex`：行内和块级数学公式。
- `rehype-highlight`：代码块语法高亮。
- `rehype-sanitize`：第三方插件处理后进行 HTML 清洗。
- 原生 `navigator.clipboard`：代码块复制，不额外引入 clipboard 包。

`app/web/components/markdown-content.tsx` 统一生成 h2/h3 anchor id、代码工具条和复制状态。Core 只存 Markdown，不承诺内容生成的 HTML 安全；禁止使用 `dangerouslySetInnerHTML` 绕过清洗。

Article 的 `metadata.toc` 和 `readingMinutes` 由 Core 在保存时从 Markdown 派生。Web 使用对应 `id` 生成右侧 sticky 目录和阅读进度。阅读结束区域拆为讨论面和添加评论面：讨论面读取公开评论并展示浏览/点赞/评论统计，支持按作者或正文搜索、按是否有网站或最近时间筛选；添加评论面承载点赞、评论和分享。桌面/平板在讨论面尚未接近底部时只显示左侧紧凑动作卡，评论操作可展开同一表单；触发底部观察点后，卡片通过共享布局动画移动到中央添加评论面并默认展开。手机端动作卡先以 sticky 横条出现，添加评论面在讨论面之后堆叠。新增运行时标题 ID 算法时必须同步 Core metadata 约定和 Admin 编辑/生成逻辑。

## 5. 评论与反应

### 评论

`ArticleDiscussion` 与 `CommentComposer` 使用 React Hook Form、Zod 和 TanStack Query，`CommentThread` 仅作为 Thought 详情的兼容组合：

1. `comments(slug)` 读取 Core 返回的 APPROVED 评论。
2. 表单要求正文 3 到 4000 字符，作者名/网站可选，附轻量验证码。
3. 讨论面在客户端对公开评论执行搜索和筛选，不复制 Admin 审核筛选或新增 Core 查询参数。
4. 添加评论表单提交到 Core，成功后清空表单并失效 `comments + slug` query；失败时保留输入并显示错误。
5. Query key 为 `comments + slug`，不要把 Admin 审核状态复制到 Web。

### 反应

`getVisitorId()` 将匿名 ID 保存在 `localStorage` 的 `manifold.visitorId`。`ReactionBar`：

- GET 可携带 `X-Visitor-ID`，PUT/DELETE 必须携带。
- Web 只暴露 LIKE 操作，先乐观更新，再用 Core 返回的 `ReactionSummary` 校正；Core 保留 FAVORITE 合同以兼容已有 API 客户端。
- 失败时恢复旧快照，结束后失效 reaction query。

## 6. SEO、错误和可观测性

- `layout.tsx` 使用 `NEXT_PUBLIC_SITE_URL` 作为 `metadataBase`。
- 内容详情从同一份 Core 数据生成 title、description、canonical 和 Open Graph metadata。
- `app/error.tsx` 处理路由级异常，`global-error.tsx` 处理根级异常；错误页提供重试和 trace reference，不显示内部 stack。
- SDK 每次请求发送 `X-Trace-ID`；客户端错误通过 `reportClientError` 记录 scope、错误名、消息、stack 和 trace ID。
- Core unavailable 时优先显示可理解的恢复提示，不把网络异常转成空内容。

## 7. 配置和依赖

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Server/Browser SDK 请求 Core |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical 和 metadataBase |

主要依赖：Next.js 16、React 19、TanStack Query、React Hook Form、Zod、Radix Themes、Lucide React、Framer Motion、Markdown/公式/高亮链路。新增依赖必须说明用户能力、包体、SSR/CSR 影响和安全边界，并更新 `app/web/package.json`、本文与 `docs/web.md`。

## 8. 设计和开发约束

1. 颜色和字体优先使用 `app/web/app/globals.css` 中对齐 `docs/design-system/src/tokens.css` 的变量。
2. 不在页面组件中直接拼接 Core URL，不直接计算 Core 统计或状态。
3. 新增 Client Component 前确认是否真的需要浏览器状态，避免把整页改成 CSR。
4. 页面必须有 loading/error/empty 状态和移动端约束；按钮使用现有图标体系和可访问名称。
5. Markdown 必须经过 sanitize；任何 renderer 改动都要检查 XSS、标题锚点和代码复制。

## 9. 修改与验证

修改 Web 时同步检查：

- `packages/contracts/README.md`、`packages/sdk/README.md` 是否仍描述真实调用。
- `docs/core.md` 是否需要更新响应、参数或错误说明。
- `docs/admin.md` 是否共享了 Markdown、内容类型或 API 变化。
- `docs/web.md` 索引和 `app/web/README.md` 是否仍准确。

```bash
pnpm --filter @manifold/web typecheck
pnpm --filter @manifold/web lint
pnpm --filter @manifold/web build
pnpm browser-test
```
