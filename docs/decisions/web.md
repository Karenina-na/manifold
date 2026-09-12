# Web 当前架构与 API 消费契约

> 本文记录 `app/web` 的当前实现，而不是未来页面规划。修改 Web 路由、页面数据、Core 调用、Markdown 渲染、评论/反应、SEO、可观测性或设计约束时必须同步本文。历史方案不得把 Projects、Technology、Manuscript 等已移出范围的内容写成当前功能。

当前 API 约定：内容搜索和首页内容读取统一使用 SDK 的 `content()` 方法；详情链接由 Web 边界的 `buildHref()` 按内容类型和 slug 生成，Core 不返回 `href`。

## 1. 项目定位

Web 是公开阅读端，负责把 Profile、Stats、Thoughts 和 Writings 组合成个人数字花园。它不持有业务数据，不读 SQLite，不导入 Admin 或 Core Go 包，所有 Core 请求都通过 `@manifold/sdk`。

运行时边界：

```text
Next Server/Browser Components
          |
          +--> @manifold/sdk --> Core /api/v1
          +--> @manifold/contracts
```

Server Component 负责首屏数据、详情读取和 SEO；Client Component 负责评论、反应、导航菜单、命令式搜索、主题偏好、错误恢复和局部状态。顶部导航固定为居中 860px 毛玻璃容器，导航项由站点设置的 `navigation` 配置驱动（外链项新窗口打开；配置为空时回退内置 Home/Writings/Thoughts/Chain 四项），仍使用 route-aware pill；搜索通过现有 SDK 的 `content({ q, kind: ["ARTICLE", "THOUGHT"], pageSize: 8 })` 同时检索两类公开内容，并提供 Profile 的简历链接。主题偏好仅保存在浏览器 `localStorage` 的 `manifold.theme`，不改变 Core 数据或公共 API。根布局是 async Server Component，除渲染全局 Chrome（导航、页脚、命令面板 REPL）外，还并行通过 `loadSiteData()` 读取站点设置（`site()`）：`title`/`description` 驱动 `generateMetadata`（浏览器标题、`%s | 站点标题` 模板与默认 SEO 描述，读取失败回退内置 "Manifold" 文案），`title` 同时作为 FloatingRepl 的 `displayName`，`navigation`/`footer`/`social` 分别传给 SiteNav 与 SiteFooter；Core 不可用时回退为空列表/内置文案，不报错。根布局不再为 REPL 预取 Article 归档：`papers`/`open` 两个命令是归档的唯一消费者，而 REPL 在几乎每次页面访问中都是关闭的，因此归档改由 FloatingRepl 在**首次展开时**经浏览器 SDK 惰性请求（`content({ kind: "ARTICLE", pageSize: 50 })`，`useRef` 保证只发一次，失败时重置以便重试），把一个 50 篇的请求移出所有路由的关键路径。站点设置中 `commentsEnabled=false` 时，Writing/Thought 详情页（`loadSiteData()` 读取开关）不渲染讨论面与添加评论面；Core 同时在公开评论接口返回 403 兜底。Radix Theme 根节点使用 `hasBackground={false}`，由 Web 的 `--surface-paper` 统一管理页面背景，避免第三方主题默认白色背景形成横向色带。

主题是单一事实来源 `lib/theme.ts`（存储键 `manifold.theme`、事件名 `manifold:theme`、"非 dark 即 light" 的归一化、阻塞脚本与外部 store 读写对全部集中在此），避免此前导航与 REPL 各写一份 `localStorage` 键、Radix `appearance` 却硬编码为 `light` 的三方不一致。根布局在 `<body>` 首个子节点渲染一段**阻塞式内联脚本**（`themeInitScript`），在首帧前把存储值写到 `document.documentElement.dataset.theme`，消除暗色读者的浅色闪烁；该脚本必须内联且早于应用 bundle，因此经 `contentSecurityPolicyNonce()` 从**请求头**读回 `proxy.ts` 下发的 nonce 并标注 `nonce={nonce}`（见第 6 节）。脚本执行后 DOM 属性——而非 `localStorage`——是运行时事实来源（REPL 的 `theme` 命令也只经 `applyTheme()` 写属性），React 侧由 `components/theme-provider.tsx` 的 `useSyncExternalStore(subscribeToTheme, readCurrentTheme, serverTheme)` 读取，服务端快照固定为 `light`；`Providers` 内的 Radix `Theme` 由该 context 派生 `appearance`，导航开关与 REPL 命令都改走同一 `toggleTheme`/`applyTheme`，无需 effect 即可保持同步。

## 2. 页面与路由

| 路由 | 类型 | Core 数据 | 行为 |
| --- | --- | --- | --- |
| `/` | Dynamic Server Component | profile、site、全部公开 Article/Thought 历史、stats、tags | 站点设置 `sections` 驱动的首页区块（枚举 `PROFILE/BACKGROUND/RECENT_CONTENT/UPDATES/SERIES/CONTACT`，含顺序）、按时间排序的 Recent Content 双列与可缩放 Updates 时间轨道等 |
| `/thoughts` | Dynamic Server Component + client archive controls | `content({ kind: "THOUGHT", page, pageSize: 8, tag, q })`、`tags({ kind: "THOUGHT" })` | Core 配置驱动的置顶 Thought（仅默认视图展示）、按年份/月份/日期分块的纵向时间轴、服务端分页，以及置顶与时间轴之间的搜索和多 tag 过滤（OR 语义，URL `q`/`tag` 可重复/`page` 同步） |
| `/thoughts/[slug]` | Dynamic Server Component | `loadContentDetail()` → `contentBySlug(id, { referrer, visitorId })` | 专属 Thought 详情页：沿用 Writing 详情的纸面结构（返回行、标题面、正文面、讨论面、添加评论面）但不使用阅读壳；标题面展示 eyebrow、✦ 灰色摘要、日期/tag 与点赞/观看/评论计数，`question` 作为 serif 反思引言块，`context`/`source` 作 mono 脚注；标题面与正文面之间渲染 `packages/render` 的 `ReadingProgress` 阅读进度轨（经 `ThoughtSurface` 的 `progress` 开关，复用 Writing 右侧目录的轨道与百分比视觉，无目录链接：宽屏为正文右侧吸附竖轨，≤1300px 退化为正文面上方的横向进度行）；讨论面（统计、搜索、筛选）与添加评论面作为两个独立块依次置于正文面下方，与 Writing 详情同构，无目录链接与浮动动作卡；非 THOUGHT 内容或读取失败一律 404 |
| `/writing` | Dynamic Server Component + client archive controls | `content({ kind: "ARTICLE", q, tag, sort, aiAssisted, page, pageSize })`、`tags({ kind: "ARTICLE" })` | 双栏长文归档、置顶首篇、搜索、多标签筛选（OR 语义）、最新/最早/最近更新排序与悬浮侧栏 |
| `/writing/[slug]` | Dynamic Server Component + client reading controls | `contentBySlug(slug, { referrer, visitorId })` | 返回 Writing 入口作为标题阅读面的独立上方行：referer 与请求 host 同源（本站来源）时走浏览器历史返回，保留归档页滚动位置与 URL 查询参数（搜索/标签/排序），无本站来源回退普通导航；其下为四段同宽的不透明阅读面（标题、正文、讨论、添加评论）、同排日期/阅读时长/语言/统计、Markdown、右侧进度目录、评论和反应；讨论面展示统计、搜索和筛选，添加评论面在接近底部时由桌面/平板左侧紧凑动作卡通过共享布局动画展开；越过激活线后继续下滑保持展开，仅向上越回激活线才恢复左侧，手机端在讨论面之后堆叠；非 ARTICLE 内容、未发布或读取失败一律走标准 404（`not-found.tsx` 渲染 "That piece is not here." 安抚页） |
| `/health` | Route Handler | 无 | Web 进程 liveness，Core 健康检查仍为 `/healthz` |
| `/chain` | Dynamic Server Component + client explorer | `chain()`、`chainBlocks({pageSize:20})` | 锚定链浏览器与验证页（`docs/chain.md`）。Hero 沿用归档页同款 eyebrow + serif H1（无说明性副文案），右侧附 `● Mining` 脉冲徽标与 tip 哈希片段作为链实时状态指示；下方 1080px shell 内依次渲染 `Reveal` 渐显的五个面板（与归档同款 fade-rise 节奏、延迟与 `prefers-reduced-motion` 守卫），分页器复用共享 `Pagination` 组件：(1) 概览——四列 `chainStat`（`Height` / `Commitments` / `Proof` / `Site key`，hairline 分割、serif 数值、mono 副标签），底部 `genesis <hash> ─── tip <hash>` 链接带用 `chainLinkRule` 的虚线渐变线；(2) `Sealed sequence`——挂载时用 `chainBlocks({page:1,pageSize:100})` 拉取**整条已封链**（Core pageSize 上限 100）并倒序为 genesis→tip 的 `chainSpine` 横向节点链，每个 `chainSpineCube` 显示区块号、哈希前缀与锚定数，节点间用 `chainSpineLink` 箭头连接，tip 节点 `data-tip="true"` 使用 accent 边框，hover 抬升 3px；`chainSpineNav` 两侧 chevron 按钮按容器宽 70% 平滑滚动（`overflow-x:auto` + `scroll-behavior:smooth`，触摸可滑动），**不依赖底部账本分页**；提交新块后 `spineRefresh` 触发全量重拉；选中节点显示 `chainSpineDetail` 字段卡（Block / Hash / Prev hash / Merkle root / Nonce / Target / Certificates / Sealed），卡内 `chainSpineJump` 按钮跳转到下方账本对应块行并展开证书（目标块不在当前页时自动回第 1 页）；(3) `Prove a commitment`——**左右分栏**（`chainVerifyGrid`，≤900px 窄屏堆叠）：左栏 `chainVerifyLeft` 为 `chainSegmented` 切换 Payload/SHA-256/Slug 三种模式 + 单输入控件，Run verification 按钮触发 `client.verifyPayload / verifyByHash / verifyContent`（不在浏览器做哈希或规范化），结果以 `chainReceipt[data-verdict]` 凭据卡呈现：verified（accent 边框 + ShieldCheck 图标）/ mismatch / not-found / error 四态，含 `chainCheckRow` 三项（signature valid/invalid、chain intact/tampered、lookup mode），存在锚定时附加 `chainReceiptRows`（Subject hash 可复制 + Source/label + Block `#n` 或 pending + Committed + Certificate）；verified 时凭据卡底部追加 `chainContext`「Chain position」`prev → current → next` 三块 **spine 同款 cube 节点**（`chainContextBlock` 复用 `chainSpineCube`/`chainSpineMeta`，`data-current` 当前块 accent 高亮），每块 `chainContextJump` 按钮复用 `openInLedger` 跳转并展开账本行；右栏 `chainVerifyRight` 为**验证过程 graph**（`chainGraphPanel`）：Core `VerifyResponse.steps` 五步（lookup/signature/merkle/block-hash/chain）依次点亮（240ms/步，无 hover tooltip，详情以点击展开为唯一入口），**点击**节点展开 `chainGraphDetail` 真实计算明细——**以 hover 摘要（`step.detail`）为引导行、比 hover 更详细**：`block-hash` 特化为 preimage 7 段 pill（`|` 分隔 → `sha256` 箭头，`data-preimage`，**完整值**）+ `data-compare` 完整对比（recomputed / stored / match `=== ✓`，stored 取 context.current.hash）；其余步骤为 `data-step-inputs` 名值网格（签名 4 行、链重放 5 行统计），merkle 追加 `data-merkle-path` 完整审计路径（leaf / siblings / root）；`data-step-comps` 逐层计算行带 `L1/L2…` 层级标号（merkle 每层 `sha256(a‖b)` → 父值、块哈希 `sha256(preimage)`，**完整值**），`data-step-verdict` 结果 pill 以 `✓/✗` 符号 + 短数据文案（如 `recomputed == stored ✓`、`root == certRoot ✓`、`intact ✓`）收尾；(4) `Commit a payload`——textarea + 可选 label（≤64 字符），`client.submitAnchor` 成功后把提交记录（原文 + label + hash）追加进 `localStorage`（`manifold.chain.pendingCommits`，上限 8 条）并渲染为横向卡片网格（`chainCommits`/`chainCommitCard`，每卡含截断原文、复制按钮、pending/sealed 状态）；冷却期后可继续追加多条，刷新后记录仍在，加载时对 pending 条 `verifyByHash` 自动升级已封块为 Sealed + 块号；提交后刷新当前页区块列表；(5) `Blocks` 账本——`chainSection` 沿用 `thoughtSectionHeading` 标题样式，行使用 `chainLedgerRow`（`#index` + 哈希 `HashLine` 自动高亮 PoW 前导零 + `prev/root/nonce/proof` 元信息 + 锚定数 chip + UTC 时间 + chevron），每行带 `ledger-block-<id>` 锚点供 spine 跳转，左栏有 `chainLedgerSpine` 纵向虚线串联区块节点，hover 时整行向 X+3px 位移并染 `accent-soft`；账本底部**始终**渲染共享 `Pagination`（Page x of y，单页时显示禁用态），页码写入 URL `?page=N`，浏览器 back/forward 恢复原页码与列表；展开后 `chainLedgerDetail` 显示 `chainCertList`：`chainSourceChip` 含按 source 染色的圆点（content/visitor 走 accent，其他走 ink/muted），每行主体为 Core 派生的 `summary` 概述（如 `Writing “designing-boundaries” · published · v2`）加截断 subject hash（mono 小字），附状态（anchored 绿、pending accent）、`✓ signed` 标识（依据 `siteSignature` 非空）；存在可跳转目标（内容页/评论区锚点/媒体 URL，`AnchorTarget`）时行尾渲染圆形箭头按钮（hover accent 描边 + 淡色底），无目标时占位保持对齐；`chainReceiptRows` 亦在锚定时展示 Summary 行；以 `chainDetailFoot` 标注 merkle 封证数量。底部 `How anchoring works` 面板展示三步 `chainPrimer`（01 Commit / 02 Sign / 03 Seal，每步一条 accent hairline、serif 标题、说明文案），随后 `chainFootnote` 提示"Verification replays the full chain on every check"。所有哈希与规范化仅由 Core 完成，Web 不复制链逻辑；所有面板共享 `chainPanel`/`chainSection` 半透明 paper surface + `backdrop-filter: blur(8px)` + 10px 圆角；链未连通时整面渲染空态，不报错。 |
| `/feed.xml` | Dynamic Route Handler | site、2 条 Article、3 条 Thought | 输出同源 RSS 2.0 feed，channel title/description 取站点设置（回退内置 "Manifold" 文案） |

详情页根据 content kind 选择返回路径：Thought 用 `/thoughts/{slug}`，Article 用 `/writing/{slug}`。`buildHref()` 在 Web 边界生成链接，Core 不返回 `href`。

两个详情页的 `generateMetadata` 与页面正文读取同一份内容：`lib/api.ts` 的 `loadContentDetail(slug, referrer, visitorId)` 与 `loadSiteData()` 都用 React `cache()` 包裹，因此同一次请求内 metadata 与 body 以**完全相同的参数**命中同一次 Core 调用，不再各自 `contentBySlug` 打两次。注意 Next.js 的 fetch 记忆化在这里不生效——服务端客户端每次调用都会带上 per-request 的 `X-Visitor-ID` 头，请求本身并不相同——所以去重必须落在 `cache()` 这一层，`content-loading.test.mjs` 以结构化断言钉住"详情页不得绕过记忆化 loader"。

两个详情页（Writing 与 Thought）在标题面 meta 行（`articleMeta`）的行尾右下角渲染 `AnchorBadge`（`components/anchor-badge.tsx`，经 `ArticleMeta` 的 children / `ThoughtHeader` 的 `meta` slot 注入），由 `ContentDetail.latestAnchor` 驱动：无证书（`null`）不渲染；`pending` 显示指纹前缀 + "sealing…"（点击 `/chain`），`anchored` 显示指纹前缀 + 块号（`block_3` → `block #3`）并深链 `/chain?block=<blockId>`，chain 页据此选中 Sealed sequence 对应块（在 spine 窗口内）或展开账本行（旧块），并滚动定位；徽标状态色与 hover 由站点既有 accent token 提供，不引入新设计语言。

详情页的浏览事件归因：SSR 读取 `manifold-vid` cookie 并经 `contentBySlug` 的 `visitorId` 附带 `X-Visitor-ID`，Core 按"同人同内容同 UTC 日"去重统计独立访客。访客 ID 唯一来源是 localStorage `manifold.visitorId`（`getVisitorId()`），每次客户端挂载时镜像到 `manifold-vid` cookie（`path=/`、1 年 sliding、`samesite=lax`）；Server Component 无法读 localStorage，浏览器首次直接深链详情页时 cookie 尚未生成，该次浏览按匿名事件计入，完成任一页面的客户端挂载后开始去重。

### Thoughts 归档

`/thoughts` 首屏由 Server Component 读取 URL searchParams（`q`/`tag` 可重复/`page`）并请求 Core 的 Thoughts aggregate 和 `tags({ kind: "THOUGHT" })`；翻页和筛选变化时客户端继续通过 SDK 请求对应页并把状态同步回 URL（`history.replaceState`，筛选变化重置回第 1 页）。置顶选择、目标有效性、最新项回退、置顶排除、`tag`/`q` 过滤（只作用于时间轴和总数，不影响置顶，多 tag 按 OR 命中任一标签）、排序和总页数全部由 Core 处理；Web 不再读取 Site composition 或预取完整 Thought 集合。置顶卡与时间轴之间提供 Writings 同款的搜索输入和 tag pills（共享 `TagCloud` 组件与 `writingSearch`/`tagCloud`/`tagPill` 样式，搜索防抖 300ms），tag 行末尾提供 `View all tags` 触发器，筛选激活时隐藏置顶卡，筛选无结果时显示过滤专用空态文案。

两个归档共用 `TagPicker` 弹出式标签选择器：`/writing` 在侧栏 Archive 块内提供 `View all tags →` 触发器，`/thoughts` 把触发器内联在 tag 行末尾（经 `TagCloud` 的 `action` 插槽）。点击触发器展开视口全局居中的固定面板（面板经 React portal 挂载到 `document.body`，避免父级 `backdrop-filter` 影响定位），展示该归档全部 tag 与计数，允许多选且每次点选即时经 `useArchiveFilters` 生效并同步 URL `tag` 参数（可重复）；选中 tag 在弹出面板与 tag 云中始终排最前（writings 竖排即顶部，thoughts 横排即最左）。面板在 `document` 上监听 `pointerdown`，点击面板与触发器之外的任意空白即关闭，Escape 也可关闭；触发器带 `aria-expanded`，面板为 `role="group"`。

两个归档的底部列表区块在默认着陆视图（无 `q`/`tag`/`noAi`/排序变化）以 `Reveal` 的 manual 模式渲染：首屏只展示页头、置顶卡与下滑提示箭头，列表区块保持透明，直到用户滚动使其顶边越过视口底部上方 40px（共享 `isWithinRevealViewport`，监听 window scroll 判定）才浮现。`ScrollHint` 与列表共用同一判定：manual 模式下进入归档约 400ms 后在视口底部居中显示呼吸渐进的箭头（内层 span 以 `scrollHintBreath` keyframes 无限循环"淡入—下浮—淡出"），列表浮现的同时箭头外层在 480ms 内淡出并卸载；箭头可点击（`aria-label="Scroll to list"`），点击平滑下滑约一屏，滚动本身即触发列表浮现。筛选/排序深链进入，或着陆后筛选状态变化使 `manual` 翻转为 false 时，列表 `Reveal` 与 `ScrollHint` 同步回到 IntersectionObserver 自动浮现逻辑（共享 `revealObserverOptions`，`threshold: [0, 0.12]`、`rootMargin: 0 0 -40px`；`threshold` 从 `0.12` 改为 `[0, 0.12]` 避免高区块在小视口下因可见比例不足而永不浮现）。数据错误（无列表区块）时箭头不显示。

时间轴每页展示 Core 返回的 8 条 Thought，Web 只把当前页按 UTC 年份、月份和日期分块分组，卡片可见日期也固定使用 UTC 以保持年/月/日刻度一致；页面顶部沿用 Writings 的简洁眉标题与 H1，不额外放置说明性副文案。时间轴按年份分块：每个年份以流程内的分节标题行（serif 年份加横贯细线）开始，位于卡片 surface 之外；年份块内的月份标签在左栏右对齐并通过短连接线指向纵轴，纵线与日期节点贯穿该年份的月份区，右侧内容 surface 按年份框住 Thought 卡片，并与下方分页 surface 使用同一左边界。年份、月份标签、纵线与日期节点全部使用常规文档流与层级定位，不使用绝对定位骑跨轴线。右侧卡片展示标题、tag、日期，并把编辑摘要与正文摘录分开：摘要使用星号标识和灰色文字，Core 提供的纯文本 `excerpt` 使用正文色且最多显示两行；置顶卡可显示四行正文摘录。置顶卡左上显示 `Pinned`，右上显示 tags 与日期；置顶和列表底部均在左侧展示 Core 聚合的 `likeCount`、`viewCount`、未软删 `commentCount`，右侧提供全文入口。多篇置顶以置顶行网格（`pinnedRow`）展示在归档顶部。卡片、时间刻度、全文入口和分页控件都提供 hover/focus 动画，并遵循 `prefers-reduced-motion`。

Writings 归档使用相同的信息层级：摘要以星号和灰色文字标识，正文摘录与摘要分开，普通列表最多两行，置顶 Writing 最多四行。Web 不从完整 Markdown 自行生成列表摘录，只消费 Core 的 `excerpt`；兼容旧响应时才回退到已有 `body`。

Thoughts、Writings 两个归档和评论讨论面的 Previous/Next 分页器来自共享组件 `components/pagination.tsx`（同一 `paginationSurface`/`pageButton`/`pageStatus` 样式类，仅 `aria-label` 与回调不同），单页（`totalPages <= 1`）时三个场景都隐藏分页器。

## 3. 首页数据流

`loadHomeData()` 并行调用：

```text
profile()
site()
content({ pageSize: 10, kind: "ARTICLE" })
content({ pageSize: 10, kind: "THOUGHT" })
homeTimeline()
stats()
tags()
```

两组内容只服务 Recent Content，在 Web 内按发布时间倒序混排后每类取最近 3 条；Updates 直接消费 Core `GET /api/v1/home/timeline` 的有限投影（取最新 `limit` 条后按不可变首发时间升序，默认与上限 1000），不再由 Web 循环读取内容分页。timeline 响应同时给出 `totalItems/truncated`，当前页面只渲染返回范围并在截断时标示最新范围；RSS 由独立 `loadFeedData()` 每类读取 10 条后取 ARTICLE 2 条、THOUGHT 3 条，不请求 timeline。Tags 请求独立降级为空；其余任一首页请求失败时显示 Core unavailable 状态，不暴露内部错误。统计、发布状态和内容计数只使用 Core 返回值。Now 状态数据源已随 Core 契约移除，首页不再请求 `now()`，Introduction 的 mood 状态徽标一并删除。

首页将 Profile 与 Introduction 合并为首屏画像模块（bio 上方渲染 organization，空则省略该行），Introduction 与其他首页区块共用同一实底纸面；hero 的 headline 下方渲染一行 mono 状态行，用 `stats` 的 `articleCount/thoughtCount/wordCount` 展示 `N writings · N thoughts · N words`（Core 不可用时整行省略）。其下新增 Background 区块：与 Recent content / Updates 同款的实底 paper surface（`color-mix(surface-paper 92%, white)` + hairline 边框 + 8px 圆角，与归档页列表同语言）承载 Education 与 Experience 双列，列内为固定 `60px` 左槽放 period（mono muted）+ 主体放 program/role（strong）与 institution/organization（muted）两行，行间 hairline 分割，hover 时背景轻染 accent-soft 并向右 2px 平移，任一为空显示空态提示。**首页区块由站点设置的 `sections` 配置驱动**（`PROFILE/BACKGROUND/RECENT_CONTENT/UPDATES/SERIES/CONTACT` 枚举，含顺序；site 读取失败回退六区块全序），区块不再显示编号，区块之间也不再渲染场景分隔线，桌面区块间距统一 72px、≤768px 收窄为 44px；MinimalMetadata 的右侧锚点进度轨由同一配置派生（左侧时钟与 LIVE 状态条已移除，锚点刻度不显示文本，hover/focus 才展开 section 提示）。随后将 `content()` 在展示边界拆分为左右两列的 Writings/Thoughts 竖向时间线（各最多 3 条），按发布/创建时间排序展示（首页不做内容置顶策划，置顶语义只存在于各自归档页），按 kind/slug 由 Web 的 `buildHref()` 生成链接；每条时间线项在相对日期与阅读时长下方渲染一行 mono 统计（`views · likes`，`comments` 非零才显示，均取 Core 返回的 `viewCount/likeCount/commentCount`），不再叠加绝对日期；双列下方渲染 `tags()` 前 8 个标签的 Top tags 展示行（纯展示 pill + 计数，无筛选交互；tags 请求独立降级，失败不渲染整行）。其下展示 Core 返回的最新范围，并按 `publishedAt`（不可变首发锚点）升序构建横向 Sequence 轨道：月份覆盖数据范围且等距分布（月份标签与节点日期按实测轨道宽度动态减密，每标签保留 ≥44px 阅读间距，密集时节点日期整组隐藏，日期仍可从节点预览读取），节点在对应月份区间内按日期比例定位；同一天的多个更新合并为一个日期节点，鼠标 hover 或键盘 focus 后在竖向预览中依次展示当天每条更新的标题、类型、摘要、时间和链接；轨道月份刻度下方渲染一条季节带（春/夏/秋/冬四段低饱和语义色，按连续同季月份合并，窄段自动隐藏文字标签）。轨道采用地图缩放式时间窗口：区块头部右侧单个按钮（完整响应显示 `All time`，截断响应显示 `Latest N`，缩放窗口显示 `Last Nd/Nmo`）点击展开面板，面板内一个连续滑块（0–100）平滑控制窗口大小（`0` = Core 返回范围，`100` = 最细窗口最近 7 天，默认即最近 7 天），窗口锚定最新内容日期并向旧端扩展，`Reset` 一键恢复默认最近 7 天窗口；窗口变化时窗口内月份/节点/季节带重新映射拉伸到整个轨道宽度（左右撑满，非裁剪遮蔽），滑块 thumb 通过轨道容器内边距约束不超出控件；点外部或 Esc 关闭，窗口内无更新时显示空态文案；区块头部 hint 用 `stats` 展示 `{contentCount} notes · {wordCount} words`（Core 不可用时回退静态文案）。后续展示 Profile 的 My Series 索引：每条 series 占用一条紧凑两行条目（与 Background/Recent content/Updates 共用同款实底 paper surface + hairline 边框 + 8px 圆角），左槽 26px 放 mono accent 的序号（如 `01`），主体首行是 16px italic serif 的 name（视觉主元素），第二行 mono 小字的 `CATEGORY · host` 索引（host 自动剥协议与尾斜杠并 ellipsis 截断），行尾 16px 处放 ↗ 箭头；描述（description）只在 hover/focus 的 FloatingTooltip 中展示，避免每行过胖；条目高度 ~60px，区块总高约为之前卡片版的三分之一。Contact 区块与 Series 共用同款实底 paper surface + hairline 边框 + 8px 圆角，内部仍是纯图标 rail（无文字行），Contact 在列表前渲染 `profile.websiteUrl` 合成的 Website 条目（Globe 图标、tooltip 显示去协议 URL），websiteUrl 与 contacts 均为空才显示空态；Series/Contact 的 hover/focus 详情由 Web Client Component 通过 `createPortal` 渲染到 `document.body`，使用视口边界夹紧和最高层级，避免被 section 动画或其他文本遮挡，并通过 `aria-describedby` 关联到对应入口。SiteFooter 使用匿名 `manifold.visitorId` 每 60 秒向 Core presence 发送心跳，展示最近 5 分钟活跃访客数，不使用 mock 数字；footer 底行文案与 social 链接来自站点设置（无配置时回退 "Built for notes that stay in motion." 且不渲染链接行）。以上共同信息的排版参考仓库根目录 `1.html`，但内容仍以 Core 返回值为准；滚动渐显由 Web Client Component 的 IntersectionObserver 提供，不改变 Core 状态。

## 4. Markdown 阅读器

Web 和 Admin 通过共享包 `packages/render` 使用相同的 Markdown 能力组合（渲染组件、样式与依赖只在该包内维护，修改后必须按 `packages/render/README.md` 同步验证两端）：

- `react-markdown`：React 渲染边界。
- `remark-gfm`：表格、任务列表、删除线等 GFM。
- `remark-math` + `rehype-katex` + `katex`：行内和块级数学公式。
- `rehype-highlight`：代码块语法高亮。
- `rehype-sanitize`：第三方插件处理后进行 HTML 清洗。
- 原生 `navigator.clipboard`：代码块复制，不额外引入 clipboard 包。

`packages/render` 的 `MarkdownContent` 统一生成 h2–h6 anchor id、代码工具条和复制状态；代码块与 GFM 表格在 `render.css` 中提供边框、表头底色与可见的横向滚动条（长代码行、宽表格横向滚动而不撑破列宽）。代码块为双模式配色：`:root` 默认暖纸浅底（`#f4f3ee`），web 暗色主题经 `globals.css` 的 `--mdr-code-*` 变量切为深底语法色；`language-diff` 代码块按行着色新增/删除；代码开启编程连字。GFM callout（`> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]`）与脚注在 mdast 层插件处理：callout 渲染为语义色卡片（lucide 图标 + mono 标签），脚注引用为胶囊徽标（hover 浮窗显示注文）且定义收拢为文末虚线卡片；编号按**定义在源文中的出现顺序**生成（与 admin 编辑器 vditor/lute 的编号一致），锚点 id 取自编号（定义 `fn-N`、引用 `fnref-N`，同一脚注被重复引用时为 `fnref-N-2`…）而不是 `[^…]` 标识符，因此手工改号、删掉中间某条或使用命名脚注（`[^note]`）都不会让 ref→definition 锚点失配；未被引用的定义仍占位次但不生成返回链接，每个引用位点在定义行各对应一个 `data-footnote-backref`。行内 `<kbd>`/`<mark>` 等有限原始 HTML 经 `rehype-raw` 解析、`rehype-sanitize` 最终清洗（schema 额外放行 `mark`、`sup`/`span`/`blockquote` 的 `className`，以及脚注锚点 `a` 的 `id`/`data-footnote-ref`/`data-footnote-backref`、`li` 的 `id`、`section` 的 `data-footnotes`；`clobberPrefix` 关闭，否则 sanitize 会把脚注 id 改写为 `user-content-*` 导致 ref→definition 锚点失配）。图片（`![alt](url)`，含 Core 媒体库上传后插入的 `/api/v1/media/{id}` 绝对地址）经显式 sanitize schema 允许 `img`（属性固定为 aria*、src、srcSet、width、height、loading、decoding，协议仅 http/https）后以块级展示：`render.css` 给 `.markdown img` 提供 max-width 100%、边框圆角、`loading="lazy" decoding="async"`（组件覆写注入）与渐进模糊加载（加载中 `blur(7px)`、加载完成淡入清晰）；SVG 不在 Core 上传白名单内，外链 SVG 图片如含脚本也会被 sanitize 降级为空元素（属性白名单不含 on*）。宽表格仅在实际溢出时显示右缘渐变遮罩（滚到底自动消隐），空单元格显示占位破折号。结构块（代码/表格/图）相对正文测量向外穿透 36px 形成宽窄节奏（≤900px 视口还原为通栏，不与 TOC 列重叠）。`ReadingShell`/`ArticleSurface`/`ThoughtSurface` 提供两端共用的阅读面骨架（网格、TOC、讨论/评论 slot）与 `render.css` 主题令牌（Web 在 `globals.css` 以 `--mdr-*` 变量映射自身主题，Admin Render tab 复用浅色默认值）。Web 的 `components/markdown-content.tsx` 仅是对共享包的 re-export shim。Core 只存 Markdown，不承诺内容生成的 HTML 安全；禁止使用 `dangerouslySetInnerHTML` 绕过清洗。

Article 的 `metadata.toc` 和 `readingMinutes` 由 Core 在保存时从 Markdown 派生。Web 使用对应 `id` 生成右侧 sticky 目录和阅读进度。阅读结束区域拆为讨论面和添加评论面：讨论面分页读取公开评论并展示浏览/点赞/评论统计，搜索走 Core `q` 参数、按是否有网站或最近时间在当前页内筛选；添加评论面承载点赞、评论和分享。桌面/平板在讨论面尚未接近底部时只显示左侧紧凑动作卡，评论操作可展开同一表单；触发底部观察点后，左侧卡片淡出、底部添加评论面淡入（两处使用独立 `layoutId`，不再跨位置共享布局动画，避免 FLIP 动画期间滚动条高度闪烁），默认收起仅显示动作行，点击 `Comment` 或登录图标才展开表单。评论处于提交中或展示成功反馈时，紧凑动作卡与底部添加评论面不会因滚动位置互相替换，避免成功反馈在动画中途被卸载；成功卡的 View your comment 平滑滚动定位到新评论气泡。触发点继续滑过视口顶部时保持底部状态，只有向上滚动并越回同一激活线后才恢复左侧卡片，避免观察点离开视口时发生反向切换；讨论面内容或字体等导致布局变化时由 ResizeObserver 重新计算。手机端动作卡先以 sticky 横条出现，添加评论面在讨论面之后堆叠。无评论时讨论面显示 "Start the thread" 引导按钮，点击通过 `manifold:open-composer` 自定义事件展开评论表单并聚焦正文输入框。新增运行时标题 ID 算法时必须同步 Core metadata 约定和 Admin 编辑/生成逻辑。

## 5. 评论与反应

### 评论

评论展示由站点设置 `commentsEnabled` 门控：Writing/Thought 详情页经 `loadSiteData()` 读取开关，关闭时 SSR 直接不渲染讨论面与添加评论面（`ArticleDiscussion`/`CommentsSection` 亦接受 `commentsEnabled=false` 提前返回 null，客户端 queries 同时禁用）；Core 公开评论接口在关闭时返回 403 `COMMENT_DISABLED` 兜底，管理端评论接口不受此开关限制。

`ArticleDiscussion`、`CommentList`/`CommentItem` 与 `CommentComposer` 使用 React Hook Form、Zod 和 TanStack Query；Thought 详情页通过 `CommentsSection` 在同一 `ReplyContext` 下组合讨论面与独立的添加评论面，Writing 详情由 `ArticleReadingShell` 提供同一 Provider：

1. `comments(slug, { page, pageSize, q })` 分页读取 Core 返回的公开评论（创建即公开；已软删评论不会出现）。隐藏评论保留线程节点，但 Core 已清除作者名、网站、正文和头像种子，Web 只渲染 `This comment was hidden by moderation.` 占位符；隐藏不级联回复。分页只作用于顶层评论，每页 10 条，回复随其顶层同页返回；Web 按平铺的 `createdAt` 升序列表以 `replyToId` 组装线程。回复缩进封顶两级，更深的回复保持同级，由 `.commentNest` 提供竖线缩进。
2. 评论渲染：匿名/访客评论为点阵头像（`CommentAvatar`，按 `avatarSeed` 或评论 ID 确定性生成），GitHub 登录评论（`authorProvider="github"`）直接用 `authorAvatarUrl` 渲染圆角头像（`referrerPolicy="no-referrer"`）并附 `via GitHub` 徽标；名字旁以 `formatRelativeTime` 显示英文相对时间。评论正文经 `packages/render` 的 `CommentMarkdown` 渲染轻量 Markdown（GFM + 软换行 `remark-breaks`，单次 Enter 即换行；sanitize schema 移除标题与 `img`，评论不得注入标题大纲或外链图片；无代码工具栏/KaTeX/目录机制），输入控件为原生 `<input>`/`<textarea>`（44px/5 行，8px 圆角纸面底，避免 Radix 容器双边框）。hover 或键盘聚焦气泡时右上淡入 Reply 按钮。
3. Reply 点击写入 `ReplyContext`，平滑滚动到 `#comment-composer` 并聚焦正文输入；composer 顶部显示 `Replying to @name` 引用条（灰色引用原文）可取消，提交携带 `replyToId`。
4. 登录入口是添加评论面动作行内两个纯图标按钮（GitHub / Guest，位于 `Add a comment` 标签右侧、点赞左侧），hover/focus 经 `FloatingTooltip` 说明（GitHub 显示 `Sign in with GitHub` 或 `Signed in as …`，Guest 显示 `Commenting as guest` 或 `Comment as guest`），当前身份模式以 accent 描边高亮（`aria-pressed`）。初始模式由会话推导：`authMe()` 已登录为 GitHub、否则为访客；点击任一图标固定该模式并展开表单。访客表单要求正文 3 到 4000 字符，作者名/网站可选（Name 与 Website 输入框并排一行），附随机加法验证码：每次打开表单或发送成功后由客户端重新生成（`useEffect` 中生成，SSR 阶段不生成以免水合不一致），占位符不显示答案，提交时按当前答案校验；Name 字段预填 `lib/identity.ts` 生成的组合词默认名（来自 `manifold.visitorId` 种子，持久化于 `localStorage` 的 `manifold.identity`），头像选择器 `AvatarPicker` 提供 6 个确定性候选可点选，身份随评论提交（`avatarSeed`）并在发送成功后回写本地。GitHub 身份表单隐藏 Name 与头像选择器、去掉验证码，姓名与头像来自 GitHub 资料（`authMe()` 的 `displayName`/`avatarUrl`），Website 仍可选。身份模式可在会话内随时切换：GitHub 会话点 Guest 图标即以访客表单发布（提交走独立的匿名 SDK client、不携带 `manifold-visitor` 转出的 Bearer，Core 记录为 `authorProvider="visitor"` 且不覆盖姓名/头像），点回 GitHub 图标恢复 GitHub 身份（浏览器 SDK 以 cookie 转 `Authorization: Bearer` 直连 Core，Core 服务端覆盖作者名/头像并清空 `avatarSeed`）；切换不删除登录 cookie，仅改变本次发布身份。
5. 搜索走 Core 的 `q` 参数（300ms 防抖，按未隐藏评论的作者名或正文匹配，线程级命中——任一可见回复命中即整条线程返回），搜索变更时回到第 1 页；评论计数徽标使用 `pagination.totalItems`（匹配集内全部未软删评论含隐藏行和回复）。筛选下拉（With website/Recent）仍为客户端过滤，只作用于当前页；隐藏行不满足 With website，但 Recent 仍按其创建时间保留占位符。翻页使用共享 `Pagination` 组件（`aria-label="Comment pages"`，`keepPreviousData` 平滑换页，翻页后滚动到讨论面顶部），单页时隐藏。
6. 提交是一个显式状态机（`ComposerPhase`：`editing → submitting → success`，composer 私有状态；Writing 详情仅底部 composer 通过 `onPhaseChange` 上报，用于"提交中/成功期间钉住添加评论面"）：点击发送后表单内容渐进淡出并显示遮罩转圈（`commentVeil`/`commentSpinner`，响应返回后至少停留 350ms 防闪烁）；成功后失效 `comments + slug` query 并显示对勾描画动画、"Your comment has been posted." 与两个动作——`View your comment` 用 mutation 返回的评论 ID 平滑滚动到新评论（重试等待 refetch 渲染，重试耗尽则显示刷新提示兜底），`Comment again` 渐进恢复原表单并聚焦正文；失败时回到编辑态并保留输入显示错误。面板会一直停留，直到点击按钮、开始新的回复或刷新页面。发布成功后 composer 通过 `CommentsPagingRefContext`（`CommentsSection` 与 `ArticleReadingShell` 各自提供稳定 ref）通知讨论面：顶层评论会清空搜索并跳到最后一页（旧→新排序下新顶层评论所在页），回复则留在当前页。表单展开/收起不做高度逐帧动画：卡片与表单高度一次性到位、内容以 opacity/y 淡入淡出（`overflowAnchor: none`），动画期间页面高度只变化一次而非每帧增长，避免滚动条闪烁。
7. 浏览器端 SDK 一律 `cache: "no-store"`（与服务端客户端一致）：Core 响应不携带缓存指令，新鲜度由 TanStack Query 管辖，避免 HTTP 缓存返回陈旧评论列表。
8. Query key 为 `comments + slug + page + q`，不要把 Admin 的软删状态复制到 Web。

### GitHub 评论登录

Web 承担 OAuth 的浏览器侧编排，认证逻辑仍在 Core（Web 不接触 Client Secret、不验签）：

- `GET /api/v1/auth/github/login?return_to=…`（`app/api/v1/auth/github/login/route.ts`，Node runtime）发起流程：`return_to` 必须是站内相对路径（防开放重定向），生成随机 state 与回跳目标写入 10 分钟 HttpOnly cookie（`manifold_oauth_state`/`manifold_oauth_return`），302 到 GitHub 授权页；未配置 `GITHUB_CLIENT_ID`（Web 侧 `app/web/.env.local`）时返回 503。
- 授权跑在弹窗里：Web 点击 GitHub 图标时 `window.open` 打开 `login` 路由（`popup=yes`），当前页面不导航、历史栈不动，浏览器 back 不会回到授权中间页；弹窗被拦截时降级为整页跳转（回调页用 `location.replace` 回跳，同样不污染历史栈）。
- `GET /api/v1/auth/callback/github`（`app/api/v1/auth/callback/github/route.ts`）接收 `code`+`state`：校验 state 匹配后 POST Core `/api/v1/auth/github/exchange` 换发 visitor 会话 JWT，写入 90 天 `manifold-visitor` cookie（`sameSite=lax`、非 HttpOnly——浏览器 SDK 需读取它转 Bearer 直连 Core，因为浏览器直连跨端口时 cookie 域隔离；TLS 下带 `Secure`，判定方式见第 6 节）。随后返回一个极简 HTML：若存在 `window.opener`（弹窗场景）则向 opener `postMessage({ type: "manifold:github-auth", ok })`（targetOrigin 限定本站）并 `window.close()`，父窗口收到消息后失效 `auth/me` query 刷新登录态；无 opener（降级整页跳转）则 `location.replace` 回 `return_to`。state 不匹配或 Core 换发失败时同一 HTML 发送 `ok:false`（或回 `/?oauth=state|failed`），父窗口保持原状态。该 HTML 由页面自行下发 `default-src 'none'` + sha256 脚本哈希的 CSP（见第 6 节）。
- 登录态由客户端 `authMe()` 驱动（query key `auth/me`，5 分钟 staleTime）；`manifold-visitor` cookie 删除后重新加载即回到默认访客模式。GitHub 会话长期保持（90 天），无站内登出按钮。
- 降级：Core 未配置 GitHub（`CORE_GITHUB_CLIENT_*` 为空）时 `authMe().providers` 为空，动作行只显示 Guest 图标，Web 不渲染 GitHub 图标；Core 侧对 `/auth/github/exchange` 返回 501。

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

### 安全边界：响应头、CSP 与 cookie 属性

**CSP 由 `app/web/proxy.ts` 下发**（Next.js 16 的 proxy 文件约定，构建输出里显示为 `ƒ Proxy (Middleware)`）。每个请求生成一个 nonce（`crypto.randomUUID()` → base64），**同时写入请求头与响应头**：Next.js 从请求的 CSP 头里取回 nonce 并自动加到框架自身的 `<script>` 上，因此框架脚本无需逐标签手工标注。唯一手工标注的是根布局的阻塞式主题初始化脚本——它必须内联且早于应用 bundle，`layout.tsx` 的 `contentSecurityPolicyNonce()` 从**请求头**里读回同一份策略并解析出 nonce 传给 `<script nonce={nonce}>`（不重算，避免与响应头里的值不一致）。`script-src 'self' 'nonce-…' 'strict-dynamic'`；开发环境额外放行 `'unsafe-eval'`（React 需要它重建服务端错误栈），生产不放行。

选择 nonce 而不是 `'unsafe-inline'` 的原因：访客会话是 90 天、不可撤销、**必须对 JS 可读**的 JWT（浏览器 SDK 读 `manifold-visitor` 转 Bearer），因此任何 XSS 都等于持久的身份劫持，而 `'unsafe-inline'` 恰好放行这种场景需要的注入式内联脚本。

其余指令：

| 指令 | 取值 | 理由 |
| --- | --- | --- |
| `style-src` | `'self' 'unsafe-inline'` | Radix Themes 与 KaTeX 在运行时注入 `<style>` 并输出内联 style 属性；内联样式不是脚本执行面 |
| `img-src` | `'self' data: blob: https:` | Markdown 正文可引用任意远端图片、评论头像来自 GitHub；限定 https 方案而非放开任意来源 |
| `connect-src` | `'self'` + `NEXT_PUBLIC_CORE_URL` 的 origin | 浏览器 SDK 直连 Core 是跨 origin 的 |
| `object-src` / `base-uri` / `form-action` / `frame-ancestors` / `frame-src` | 全部收紧（`'none'` 或 `'self'`） | 站点不使用插件、`<base>`、站外表单或 iframe |
| `X-Content-Type-Options` | `nosniff` | 与 Core 侧同名的响应头一致（Core 只服务自身响应） |

matcher 排除 `/api`（该前缀只服务 JSON），因此**唯一返回 HTML 的 `/api/v1/auth/callback/github` 自行下发 CSP**：用 `sha256` 哈希钉住自己的内联脚本（`lib/security.ts` 的 `inlineScriptHash`），而不是依赖 nonce。nonce 要求页面动态渲染——本项目每个页面都已 `export const dynamic = "force-dynamic"`，因此没有静态优化损失。

**cookie 属性**：

- `manifold-visitor` 是 90 天、不可撤销、必须对 JS 可读的 JWT，所以不能 `httpOnly`，但必须 `Secure`；`manifold_oauth_state`/`manifold_oauth_return`（`login` 路由）同理。是否加 `Secure` 由 `lib/security.ts` 的 `requestIsSecure()` 判定——**优先 `x-forwarded-proto`，回退请求协议**——避免自托管纯 http 部署被浏览器静默丢弃 cookie 而导致登录失效。反向代理终止 TLS 时该头必须透传。
- 客户端侧的 `manifold-vid` 分析镜像（`getVisitorId()`）在 `https:` 下同样追加 `secure`。

**内联脚本不再直接拼接原始值**：回调页的 `fallback` 派生自 `manifold_oauth_return` cookie，而该 cookie 的源头是 `login` 的 `return_to` 查询参数，属攻击者可控。当前实现经 `new URL(returnTo, origin).toString()` 会把 `<`/`>` 百分号编码，因此原实现**未构成可达的注入**；但 `JSON.stringify` 本身不转义 `<`，所以现在统一经 `inlineScriptJSON()` 把 `<`、`>`、`&`、U+2028/U+2029 转成 `\uXXXX`。这既是纵深防御，也让哈希钉住的内联脚本在有人日后引入原始值时直接拒绝执行。

**REPL 的 `calc` 不再使用 `Function()`**：无 `'unsafe-eval'` 的 CSP 会直接阻断它，因此改为 `lib/expression.ts` 的纯算术解析器（`+ - * / % ^`、`**`、括号、一元正负号，`^` 右结合，除零与非有限结果报错）；原有的字符白名单正则降级为友好提示，不再充当唯一防线。


## 7. 配置和依赖

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Server/Browser SDK 请求 Core |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical 和 metadataBase |

主要依赖：Next.js 16、React 19、TanStack Query、React Hook Form、Zod、Radix Themes、Lucide React、Framer Motion、Markdown/公式/高亮链路。新增依赖必须说明用户能力、包体、SSR/CSR 影响和安全边界，并更新 `app/web/package.json`、本文与 `docs/web.md`。

自托管发布启用 Next.js `output: "standalone"`，`outputFileTracingRoot` 指向 monorepo 根目录，使 workspace 运行依赖进入追踪范围。根发布脚本按 Next.js 官方 standalone 约定补复制 `public` 与 `.next/static`，并把 pnpm 安装树裁剪、校验为 Linux x64 glibc 原生依赖。目标端以 `HOSTNAME=0.0.0.0 PORT=3000 node server.js` 运行；`NEXT_PUBLIC_CORE_URL` 与 `NEXT_PUBLIC_SITE_URL` 是构建时值，必须由打包所用 `.env.production` 提供，且可指向由反向代理终止 TLS 的独立 HTTPS origin。页面路由、数据流和 API 契约未变。

## 8. 设计和开发约束

1. 颜色和字体优先使用 `app/web/app/globals.css` 中对齐 `docs/design-system/src/tokens.css` 的变量。
2. 每类公开路由使用一种和色强调色（Home 梅 ume、Writings 縹 hanada、Thoughts 若竹 wakatake、Chain 朽葉 kuchiba，token 见 `globals.css` 的 `--hue-*`），路由作用域只替换 `--color-accent`/`--color-accent-soft`，不新增平行色板；强调色覆盖不超过表面 5%，9–10px mono 标签在 paper 上对比度 ≥ 4.5:1。
3. 不在页面组件中直接拼接 Core URL，不直接计算 Core 统计或状态。
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
