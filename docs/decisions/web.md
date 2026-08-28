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

Server Component 负责首屏数据、详情读取和 SEO；Client Component 负责评论、反应、导航菜单、命令式搜索、主题偏好、错误恢复和局部状态。顶部导航固定为居中 860px 毛玻璃容器，Home/Writings/Thoughts 使用 route-aware pill；搜索通过现有 SDK 的 `feed({ q, kind })` 同时检索两类公开内容，并提供 Profile 的简历链接。主题偏好仅保存在浏览器 `localStorage`，不改变 Core 数据或公共 API。根布局是 async Server Component，除渲染全局 Chrome（导航、页脚、命令面板 REPL）外，还通过 `loadPapers()` 服务端读取公开 Article 列表（`content({ kind: "ARTICLE", limit: 50 })`）并传给 FloatingRepl 的 `papers` 命令；Core 不可用时回退为空列表，REPL 显示无内容提示而不是报错。Radix Theme 根节点使用 `hasBackground={false}`，由 Web 的 `--surface-paper` 统一管理页面背景，避免第三方主题默认白色背景形成横向色带。

## 2. 页面与路由

| 路由 | 类型 | Core 数据 | 行为 |
| --- | --- | --- | --- |
| `/` | Dynamic Server Component | profile、site、全部公开 Article/Thought 历史、now、stats | Profile/Introduction、Recent Content、Updates、年度 Contribution activity、My Series、Contact |
| `/thoughts` | Dynamic Server Component + client archive controls | `thoughts({ page, limit: 8, tag, q })`、`tags({ kind: "THOUGHT" })` | Core 配置驱动的置顶 Thought（仅默认视图展示）、按年份/月份/日期分块的纵向时间轴、服务端分页，以及置顶与时间轴之间的搜索和多 tag 过滤（OR 语义，URL `q`/`tag` 可重复/`page` 同步） |
| `/thoughts/[id]` | Dynamic Server Component | 通过 ID 获取 Thought 详情 | 复用统一阅读器和评论/反应 |
| `/writing` | Dynamic Server Component + client archive controls | `content({ kind: "ARTICLE", q, tag, sort, aiAssisted, page, skipFirst })`、`content({ kind: "ARTICLE", sort: "newest", limit: 1 })`、`tags({ kind: "ARTICLE" })` | 双栏长文归档、置顶首篇、搜索、多标签筛选（OR 语义）、最新/最早/最近更新排序与悬浮侧栏（视口垂直居中：滚动中随内容冻结，停止后防抖 160ms 重算并动画归位，布局变化同样动画跟随，导航净空 112px，760px 以下回退静态）；两页归档共用 `useArchiveFilters` 客户端取数：搜索/tag/排序/No AI 开关和分页由 Core 在数据层执行，筛选状态经 `history.replaceState` 同步到 URL `q`/`tag`（可重复）/`page`/`sort`/`noAi`；置顶卡固定取全局最新文章且仅在默认视图（无 `q`/`tag`/`noAi` 且 `sort=newest`）展示，此时列表请求以 `skipFirst` 排除该条，其余视图 `skipFirst` 不传；tag 云和计数来自 `/api/v1/tags`，选中的 tag 在云中排最前；卡片区分摘要与 Core 正文摘录，并展示聚合的浏览量和点赞数；从详情页通过浏览器历史返回时刷新 RSC 数据 |
| `/writing/[slug]` | Dynamic Server Component + client reading controls | `contentBySlug(slug)` | 返回 Writing 入口作为标题阅读面的独立上方行；其下为四段同宽的不透明阅读面（标题、正文、讨论、添加评论）、同排日期/阅读时长/语言/统计、Markdown、右侧进度目录、评论和反应；讨论面展示统计、搜索和筛选，添加评论面在接近底部时由桌面/平板左侧紧凑动作卡通过共享布局动画展开；越过激活线后继续下滑保持展开，仅向上越回激活线才恢复左侧，手机端在讨论面之后堆叠 |
| `/health` | Route Handler | 无 | Web 进程 liveness，Core 健康检查仍为 `/healthz` |
| `/feed.xml` | Dynamic Route Handler | profile、2 条 Article、3 条 Thought | 输出同源 RSS 2.0 feed，复用首页 feed 数据 |

详情页根据 content kind 选择返回路径：Thought 用 `/thoughts/{id}`，Article 用 `/writing/{slug}`。Core 返回的 `href` 是列表链接的来源，页面不自行重建业务 URL。

### Thoughts 归档

`/thoughts` 首屏由 Server Component 读取 URL searchParams（`q`/`tag` 可重复/`page`）并请求 Core 的 Thoughts aggregate 和 `tags({ kind: "THOUGHT" })`；翻页和筛选变化时客户端继续通过 SDK 请求对应页并把状态同步回 URL（`history.replaceState`，筛选变化重置回第 1 页）。置顶选择、目标有效性、最新项回退、置顶排除、`tag`/`q` 过滤（只作用于时间轴和总数，不影响置顶，多 tag 按 OR 命中任一标签）、排序和总页数全部由 Core 处理；Web 不再读取 Site composition 或预取完整 Thought 集合。置顶卡与时间轴之间提供 Writings 同款的搜索输入和 tag pills（共享 `TagCloud` 组件与 `writingSearch`/`tagCloud`/`tagPill` 样式，搜索防抖 300ms），tag 行末尾提供 `View all tags` 触发器，筛选激活时隐藏置顶卡，筛选无结果时显示过滤专用空态文案。

两个归档共用 `TagPicker` 弹出式标签选择器：`/writing` 在侧栏 Archive 块内提供 `View all tags →` 触发器，`/thoughts` 把触发器内联在 tag 行末尾（经 `TagCloud` 的 `action` 插槽）。点击触发器展开视口全局居中的固定面板（面板经 React portal 挂载到 `document.body`，避免父级 `backdrop-filter` 影响定位），展示该归档全部 tag 与计数，允许多选且每次点选即时经 `useArchiveFilters` 生效并同步 URL `tag` 参数（可重复）；选中 tag 在弹出面板与 tag 云中始终排最前（writings 竖排即顶部，thoughts 横排即最左）。面板在 `document` 上监听 `pointerdown`，点击面板与触发器之外的任意空白即关闭，Escape 也可关闭；触发器带 `aria-expanded`，面板为 `role="group"`。

两个归档的底部列表区块在默认着陆视图（无 `q`/`tag`/`noAi`/排序变化）以 `Reveal` 的 manual 模式渲染：首屏只展示页头、置顶卡与下滑提示箭头，列表区块保持透明，直到用户滚动使其顶边越过视口底部上方 40px（共享 `isWithinRevealViewport`，监听 window scroll 判定）才浮现。`ScrollHint` 与列表共用同一判定：manual 模式下进入归档约 400ms 后在视口底部居中显示呼吸渐进的箭头（内层 span 以 `scrollHintBreath` keyframes 无限循环"淡入—下浮—淡出"），列表浮现的同时箭头外层在 480ms 内淡出并卸载；箭头可点击（`aria-label="Scroll to list"`），点击平滑下滑约一屏，滚动本身即触发列表浮现。筛选/排序深链进入，或着陆后筛选状态变化使 `manual` 翻转为 false 时，列表 `Reveal` 与 `ScrollHint` 同步回到 IntersectionObserver 自动浮现逻辑（共享 `revealObserverOptions`，`threshold: [0, 0.12]`、`rootMargin: 0 0 -40px`；`threshold` 从 `0.12` 改为 `[0, 0.12]` 避免高区块在小视口下因可见比例不足而永不浮现）。数据错误（无列表区块）时箭头不显示。

时间轴每页展示 Core 返回的 8 条非置顶 Thought，Web 只把当前页按 UTC 年份、月份和日期分块分组，卡片可见日期也固定使用 UTC 以保持年/月/日刻度一致；页面顶部沿用 Writings 的简洁眉标题与 H1，不额外放置说明性副文案。时间轴按年份分块：每个年份以流程内的分节标题行（serif 年份加横贯细线）开始，位于卡片 surface 之外；年份块内的月份标签在左栏右对齐并通过短连接线指向纵轴，纵线与日期节点贯穿该年份的月份区，右侧内容 surface 按年份框住 Thought 卡片，并与下方分页 surface 使用同一左边界。年份、月份标签、纵线与日期节点全部使用常规文档流与层级定位，不使用绝对定位骑跨轴线。右侧卡片展示标题、tag、日期，并把编辑摘要与正文摘录分开：摘要使用星号标识和灰色文字，Core 提供的纯文本 `excerpt` 使用正文色且最多显示两行；置顶卡可显示四行正文摘录。置顶卡左上显示 `Featured`，右上显示 tags 与日期；置顶和列表底部均在左侧展示 Core 聚合的 `likeCount`、`viewCount`、已审核 `commentCount`，右侧提供全文入口。卡片、时间刻度、全文入口和分页控件都提供 hover/focus 动画，并遵循 `prefers-reduced-motion`。

Writings 归档使用相同的信息层级：摘要以星号和灰色文字标识，正文摘录与摘要分开，普通列表最多两行，置顶 Writing 最多四行。Web 不从完整 Markdown 自行生成列表摘录，只消费 Core 的 `excerpt`；兼容旧响应时才回退到已有 `body`。

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

Article 的 `metadata.toc` 和 `readingMinutes` 由 Core 在保存时从 Markdown 派生。Web 使用对应 `id` 生成右侧 sticky 目录和阅读进度。阅读结束区域拆为讨论面和添加评论面：讨论面读取公开评论并展示浏览/点赞/评论统计，支持按作者或正文搜索、按是否有网站或最近时间筛选；添加评论面承载点赞、评论和分享。桌面/平板在讨论面尚未接近底部时只显示左侧紧凑动作卡，评论操作可展开同一表单；触发底部观察点后，卡片通过共享布局动画移动到中央添加评论面并默认展开。触发点继续滑过视口顶部时保持底部状态，只有向上滚动并越回同一激活线后才恢复左侧卡片，避免观察点离开视口时发生反向切换；讨论面内容或字体等导致布局变化时由 ResizeObserver 重新计算。手机端动作卡先以 sticky 横条出现，添加评论面在讨论面之后堆叠。新增运行时标题 ID 算法时必须同步 Core metadata 约定和 Admin 编辑/生成逻辑。

## 5. 评论与反应

### 评论

`ArticleDiscussion` 与 `CommentComposer` 使用 React Hook Form、Zod 和 TanStack Query，`CommentThread` 仅作为 Thought 详情的兼容组合：

1. `comments(slug)` 读取 Core 返回的 APPROVED 评论。
2. 表单要求正文 3 到 4000 字符，作者名/网站可选，附轻量验证码。
3. 讨论面在客户端对公开评论执行搜索和筛选，不复制 Admin 审核筛选或新增 Core 查询参数。
4. 添加评论表单提交到 Core，成功后清空表单并失效 `comments + slug` query；失败时保留输入并显示错误。
5. Query key 为 `comments + slug`，不要把 Admin 审核状态复制到 Web。

### 反应

`getVisitorId()` 将匿名 ID 保存在 `localStorage` 的 `manifold.visitorId`。`LikeButton`：

- GET 可携带 `X-Visitor-ID`，PUT/DELETE 必须携带。
- Web 只暴露 LIKE 操作，先乐观更新，再用 Core 返回的 `LikeSummary` 校正。
- 失败时恢复旧快照，结束后失效 likes query。

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
3. 新增 Client Component 前确认是否真的需要浏览器状态，避免把整页改成 CSR；Thoughts 和 Writing 归档共用 `useArchiveFilters` 作为筛选/翻页客户端边界：首屏数据仍由 Server Component 读取，后续搜索（防抖 300ms，立即操作先 flush 未提交输入）、tag/排序/开关和翻页由客户端 SDK 请求对应页，`history.replaceState` 同步 URL（不触发 RSC 重渲染），请求以单调序号去陈旧；浏览器回退/前进时由 Server Component 以新参数重挂载归档（`key` 含全部筛选参数）。
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
