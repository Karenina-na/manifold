# Admin 当前契约

> 本文是 `app/admin` 当前实现的权威说明。工作区、Core API 调用、query key、表单字段、认证或构建边界变化时必须同步本文。

## 1. 背景与边界

`app/admin` 是单一 owner 使用的私有管理端，负责登录、统计与 Now 状态、Profile、Writings/Thoughts 发布、评论管理（软删除/恢复）和首页 composition。它是独立的 Vite/React 应用，不复用 Web 页面组件、不访问 Core SQLite、不复制 Core 业务规则。

Core 负责最终鉴权和状态转换；Admin 只持有 session token，组织表单、查询缓存和用户反馈。

## 2. 技术架构

```text
Vite + React 19
├── App.tsx: session / Login / Sidebar / lazy workspaces
├── Mantine 9: controls and feedback
├── React Hook Form + Zod: form boundary
├── TanStack Query: server state and invalidation
├── Recharts: Dashboard chart
├── Lucide React: actions and navigation icons
├── vditor (IR mode): Context tab markdown editor
├── @manifold/render: shared reading surface for the Render tab
├── vite-plugin-pwa: manifest / service worker
└── @manifold/sdk -> Core /api/v1/admin
```

主要模块：`src/App.tsx` 管理登录、hash 路由（`#/writings`、`#/writings/{id}` 等二级页面）和未保存离开确认；`src/api.ts` 创建 SDK client；`src/lib/` 提供 hash 路由、dirty 守卫和 Core 派生规则的浏览器镜像（`content-derive.ts`）；`src/components/` 提供内容工作区共享组件（`ContentListPanel`/`ContentEditorShell`/`SaveBar`/`ChipsInput`/`ConfirmButton`/`MarkdownEditor`）；`SettingsWorkspace.tsx` 管理 Site composition；`workspaces/` 下分别负责 Dashboard（数据总览）、Profile、Writings、Thoughts、Media（图片上传与媒体库）和评论管理；`ErrorBoundary.tsx` 负责渲染恢复。组件文件用 PascalCase，工具与 hook 用 kebab-case。

Dashboard、Profile、Writings、Thoughts、Comments、Settings 通过 lazy chunk 加载，登录壳同步加载。

## 3. 登录和会话

登录表单使用 React Hook Form + Zod，调用 `POST /api/v1/admin/session`。成功后把 `accessToken`、用户名和本地过期时间存到 `sessionStorage` 的 `manifold.admin.session`。

- 页面初始化时读取 session；过期或缺失则显示登录页。
- SDK 自动发送 `Authorization: Bearer <token>` 和 `X-Trace-ID`。
- Core 返回 `ApiError`，UI 显示稳定的用户提示；不要在 Admin 重新实现 JWT 验证。
- 当前只有 `admin` 角色，没有注册、角色管理或多用户 UI。

## 4. 工作区和 API

### Dashboard

纯数据展示工作区，无编辑表单。数据全部来自 Core 聚合端点，不在浏览器重新统计：

- 指标卡行（6 张）：Published、Drafts、Total views、Likes、Comments、Visitors now，来自 `adminOverview()` 的 `content`。
- 趋势区：月度 `created`/`published` 双系列面积图（`overview.trend.monthly`，近 12 个月）；近 30 天去重浏览/独立访客面积图（`adminAnalyticsViews({ days: 30 })`）。
- 排名区：浏览量 Top 5 已发布内容与 Top 10 标签横向条形图（`overview.topContent` / `overview.tags`）。
- 动态区（结构对齐，两面板均为顶部搜索框 + 列表 + 底部分页，每页 10 条，列表区 `flex:1` 撑满使外框等高）：
  - Recent comments：复用 `adminComments()`（query key 与 Comments 工作区共享），客户端过滤未软删评论并按 authorName/body 大小写不敏感搜索，本地分页；
  - Recent activity：`adminAudit({ page, pageSize: 10, q })` 服务端分页，`q` OR 匹配事件名/操作者/资源 ID，搜索 250ms 防抖且重置回第 1 页。
- 底部系统健康卡：顶部 CPU/内存/磁盘三个环形图（used vs free，`isAnimationActive` 关闭）+ cells（version、uptime、Host（hostname · platform）、CPU（核数 · 占比）、内存/磁盘（used/total · percent，磁盘为数据库所在分区）、load average 1/5/15、进程 RSS、heap、goroutines、DB 体积、内容缓存条目、审计事件总数和启动时间）；卡片标题区带独立刷新按钮，仅失效 `admin-system` query（`system.isFetching` 时图标旋转）。资源指标由 Core 经 gopsutil 采样，单项失败显示为零值。

Refresh 按钮同时 refetch 四个 query。Now 状态功能已整体移除（Core 端点与 `NowStatus` 契约删除），Dashboard 不再承载任何 Now 编辑。

### Profile

三栏工作台：左侧分区锚点导航（Identity / Links / Interests / CV / Series / Contact）+ 中间分组表单 + 右侧实时预览（随输入渲染公开首页的简化版，Admin 自绘，不依赖 Web 组件）。窄屏（<1180px）隐藏导航，<900px 时预览移到表单下方。

`GET/PATCH /api/v1/admin/profile`，包含 displayName、handle、headline、bio、avatarUrl、location、organization、websiteUrl、resumeUrl、interests、education、experience、series、contacts。表单为结构化编辑器（react-hook-form `useFieldArray` + 嵌套 zod，行级错误落位）：

- interests 使用 chip 输入（Enter/逗号添加、× 移除、Backspace 删除末项）；
- education/experience/series/contacts 为可增删、上下排序的行编辑器，不再手写 JSON；
- contacts 每行带图标网格 picker（`github`/`x`/`mail`/`rss`/`telegram`/`podcast`/`tv`/`flame`/`message`/`at`/`radio`/空 = globe 兜底），行内实时提示公开渲染结果；Admin 复刻 Web 端 `profile-surfaces.tsx` 的 icon/label/url 启发式映射（`resolveContactKey`），两处必须保持同步；
- URL 校验：avatar/website/resume 允许空或 http(s)，contacts/series URL 必填且为 http(s) 或 mailto；headline/bio 显示字符计数；
- 表单脏状态（isDirty）出现底部 sticky 保存条（Unsaved changes · Save/Discard），保存成功后按钮短暂显示 Saved。

预览面板还原：头像/姓名/headline、organization 行、bio、`#interests`、Background（education/experience）、Contact 图标带（含 websiteUrl 合成条目与 location 遥测显示规则）、series 序号卡。query key 维持 `['admin-profile']`，保存成功后失效。

### Writings

Writings 工作区为二级页面结构，路由走 hash：列表页 `#/writings`，详情页 `#/writings/new`（新建）与 `#/writings/{id}`（编辑/查看）。固定 `kind: 'ARTICLE'`，列表由共享 `ContentListPanel` 驱动，调用 `adminContent({ kind: 'ARTICLE', status?, q?, sort?, page? })`，query key 为 `['admin-content', 'ARTICLE', { status, q, sort, page }]`（失效仍走 `['admin-content']` 前缀）。列表页为全宽单栏：顶部工具栏（搜索 `q` 300ms 防抖、状态 chips All/Drafts/Published、排序 newest/oldest/updated、总数），下方行列表 + 服务端分页；行内容镜像 Web 归档卡（状态点、标题、`✦` summary 或派生 excerpt、日期、tags、views/likes/comments），行内操作为编辑（整行点击跳详情）、发布/撤回、删除和已发布项“在 Web 打开”外链（`VITE_WEB_URL`，默认 `http://localhost:3000`）；发布/撤回/删除均为 `ConfirmButton` 的内联 Popover 二次确认（不再使用 Modal）。

| 操作 | SDK/Core |
| --- | --- |
| 列表 | `adminContent({ kind: 'ARTICLE', status?, q?, sort?, page? })` |
| 单条读取 | `adminContentItem(id)` → `GET /api/v1/admin/content/{id}`（详情页刷新/深链恢复） |
| 创建草稿 | `createContent(ContentInput)` |
| 编辑 | `updateContent(id, UpdateContentInput)` |
| 发布/撤回 | `publishContent(id)` / `unpublishContent(id)`（列表行与详情页头均可） |
| 删除 | `deleteContent(id)`（`ConfirmButton` Popover 二次确认），Core 返回 204 |

详情页由共享 `ContentEditorShell` 渲染：顶部返回链接（dirty 时经 App 确认 Modal）、状态标签、发布/撤回（Popover 确认）、Web 外链和删除；标题区带 **编辑态/锁定态切换**——查看已有内容默认锁定（`<fieldset disabled>` 整体只读，chips 移除按钮隐藏），点 Edit 解锁，点 Lock 且存在未保存修改时弹确认（放弃修改并锁定）；新建直接进入编辑态，首次保存后 `history.replaceState` 换成 `#/writings/{id}`（不产生回退步骤）。内容区分三个 Mantine Tab：

- **Meta（元信息）**：表单 `#writing-form`，按 Web 可见性分组——title、slug（新建时从 title 自动生成建议，描述行实时预览公开 URL）、summary、tags（chip 输入）、language（下拉）；`aiAssisted` 开关（写入 `metadata.aiAssisted`，Web 归档的 “No AI writing” 过滤据此生效）；派生只读展示（预计阅读时长，由 `content-derive.ts` 复刻 Core 规则）；`frontmatter`/`technologies`/`difficulty`/`repositoryUrl` 已从 UI 移除，因 Core PATCH 对 metadata 整体替换，保存时未编辑字段从已加载内容原样透传；
- **Context（正文）**：vditor IR（instant-rendering，MarkText 式）全宽编辑器，输入即得纯 Markdown 存入表单 `body`；锁定态经 `fieldset disabled` + `editor.disabled()` 只读。vditor 通过 `cdn: '/vditor'` 从 Admin 自身加载 lute/图标/语言包（`scripts/sync-vditor.mjs` 在 dev/build/browser-test 前把 `node_modules/vditor/dist` 的子集复制到 `public/vditor/`，gitignore 掉产物）；编辑器内部预览不求渲染公式/图表/代码高亮，权威渲染以 `@manifold/render` 为准。**图片上传**：粘贴、拖拽和工具栏“Upload image”按钮（触发隐藏 file input）都经 `upload.handler` 调用 `uploadMedia(file, file.name)`，成功后由编辑器 `insertValue` 插入 `![文件名](绝对 url)`；vditor handler 的返回值只是 tip 文案（不为内容插入），类型白名单外的文件与上传失败经 `vditor.tip(...)` 呈现；Writings/Thoughts 通过 `onUploadImage` 注入同一 `uploadMedia` 通路；
- **Render（渲染的）**：直接复用 `@manifold/render` 的 `ArticleSurface`（标题块、meta 行、TOC、`MarkdownContent` 正文），与 Web 阅读面同源组件；外层包 `.articleSurface/.articleSurfaceInner` 容器（Admin 侧收起横向内边距）。ArticleSurface 不传 rail slot，ReadingShell 自动切到 `no-rail` 网格——正文列（≤860px）与 220px TOC 并列居中，≤1300px 时 TOC 变为顶部横带；标题块随正文同列对齐。Context tab 的编辑器限宽 860px 居中，与正文列视觉一致。

保存使用底部 sticky save bar（仅编辑态且 dirty 时出现；`Cmd/Ctrl+S`/`Cmd/Ctrl+Enter` 触发）。因为 Tab 面板 `keepMounted={false}` 会在切换时卸载表单，SaveBar 按钮与快捷键都通过 workspace 传入的 `onSubmitRequest`（RHF `handleSubmit` 回调）提交，并短暂让出事件循环以收集 vditor 防抖中的最后输入。保存成功后停留在详情页并更新 version；409 版本冲突弹 “Saved elsewhere” Modal 提供重载。详情页数据来自 `['admin-content-item', 'ARTICLE', id]`。

### Thoughts

Thoughts 工作区为同构的二级页面（`#/thoughts`、`#/thoughts/new`、`#/thoughts/{id}`），固定 `kind: 'THOUGHT'`，列表调用 `adminContent({ kind: 'THOUGHT', status?, q?, sort?, page? })`，query key 为 `['admin-content', 'THOUGHT', { status, q, sort, page }]`。操作表与 Writings 相同。

Meta tab 字段：正文在 Context tab（vditor IR）必填；title、slug 可选（slug 为空时 Core 使用 ID，更新时置空即清除）；summary（`✦` 标记，Web 卡片与详情均渲染）；tags（chip 输入）；溯源组按 Web 图标语义分组——mood（Sparkles）、question（反引 blockquote）、context（Compass）、source（BookOpen）。Render tab 直接复用 `@manifold/render` 的 `ThoughtSurface`（含 ReadingProgress）。保存条、锁定切换、快捷键、vditor 提交时序与 409 处理与 Writings 一致；详情数据来自 `['admin-content-item', 'THOUGHT', id]`。

共享模块：`lib/useHashRoute.ts`（hash 解析/导航/受守卫的 `requestNavigate`）、`lib/dirty-guard.ts`（编辑器注册 dirty 检查，App 侧栏与返回链接共用确认 Modal）、`lib/content-derive.ts`（excerpt/阅读时长/TOC 的 Core 规则浏览器镜像）、`components/ContentListPanel.tsx`（列表面板、行、状态/排序/分页）、`components/ChipsInput.tsx`（标签 chips 输入）、`components/SaveBar.tsx`（未保存横条与跨 Tab 提交按钮）、`components/ContentEditorShell.tsx`（详情页壳：三 Tab、锁定切换、状态操作、409 Modal）、`components/ConfirmButton.tsx`（Popover 内联二次确认，支持 icon-only）与 `components/MarkdownEditor.tsx`（vditor IR 封装：初始化就绪门槛 `after()`、`input`/`setValue` 值桥、锁定 `disabled()/enable()`）。`ProfileWorkspace` 的 interests chip 输入复用同一 `ChipsInput`；`lib/content-derive.ts` 与 Core 的派生实现必须保持同步；日期展示统一使用 `@manifold/render` 的 `formatDate`。

规则：所有更新带 `expectedVersion`；新建总是 DRAFT；两个内容工作区的写入失效统一使用 `['admin-content']` 前缀并同步失效 `admin-overview`（Thoughts 另失效 `admin-thought-config`，保证置顶选择器同步）。

### Media

侧栏 Media 项路由 `#/media`（`MediaWorkspace.tsx`）。列表来自 `listMedia({ q?, page? })`，query key `['admin-media', { q, page }]`（失效统一 `['admin-media']` 前缀）：搜索防抖 300ms，`page`/`pageSize` 分页，按 `createdAt` 降序。上传入口三个——拖放区、点击区（隐藏 file input）、编辑器（见 Context tab）；经 `uploadMedia(file, file.name)` 逐个上传，白名单 png/jpeg/webp/gif/avif，失败（超限 413、类型 415 等）在 dropzone 下方的 Alert 呈现 `error.message (code)`。卡片网格（缩略图懒加载、mime/体积/日期），每张卡提供 **Copy markdown**（剪贴板写入 `![filename](url)`，2.4s 内回显 Copied）和 ConfirmButton Popover 删除（`deleteMedia` → 204 后失效列表；Markdown 引用会变死链，Core 不做引用追踪）。发布正文里的图片由 `@manifold/render` 直接渲染。

### Comments

`adminComments()` 读取全量评论（含已软删，按 `createdAt` 降序）；Delete 调用 `DELETE /api/v1/admin/comments/{id}`（软删除），Restore 调用 `POST /api/v1/admin/comments/{id}/restore`，成功均为 204。操作后失效 `admin-comments` 和 `admin-overview`。评论创建即公开，这里只做软删除/恢复管理。

Now 状态功能已整体移除（Core 端点删除），本仓库无对应工作区。

### Settings

Site 调用 `GET/PATCH /api/v1/admin/site`，包含 `featuredContent`、`navigation` 和 `sections`。Thoughts 置顶独立调用 `GET/PATCH /api/v1/admin/thoughts/config`；Settings 以每页 50 条按 cursor 读取全部已发布 Thoughts 填充 Pinned thought 选择器。置顶与 Site composition 使用两个独立保存动作和 mutation，避免跨资源部分成功被误报为整体失败；置顶保存将所选 ID 或 `null` 写入 `thoughts_config`，Core 最终校验目标必须是已发布 Thought，清空后公开归档由 Core 回退最新项。浏览器仍用 Zod 校验 navigation JSON 和 sections。

## 5. Query key 和失效

| Query key | 来源 | 写入后失效 |
| --- | --- | --- |
| `admin-overview` | `adminOverview()` | Dashboard 手动刷新 |
| `admin-analytics` + days | `adminAnalyticsViews({ days: 30 })` | Dashboard 手动刷新 |
| `admin-system` | `adminSystem()` | Dashboard 手动刷新 |
| `admin-comments` | `adminComments()`（Dashboard 评论面板与 Comments 工作区共享） | 软删除/恢复评论、Dashboard 手动刷新 |
| `admin-audit` + page + q | `adminAudit({ page, pageSize: 10, q })` | Dashboard 手动刷新 |
| `admin-content` + `ARTICLE` + `{ status, q, sort, page }` | Writings 列表 `adminContent({ kind: 'ARTICLE', … })` | 内容创建、更新、发布、撤回、删除（统一失效 `['admin-content']` 前缀） |
| `admin-content` + `THOUGHT` + `{ status, q, sort, page }` | Thoughts 列表 `adminContent({ kind: 'THOUGHT', … })` | 同上 |
| `admin-content` + `THOUGHT` + `PUBLISHED` | Settings 的置顶 Thought 选项 | 同上 |
| `admin-content-item` + kind + id | 详情页 `adminContentItem(id)` | 单条保存、发布/撤回后直接 setDraft 更新；重载时失效该 key |
| `admin-profile` | `adminProfile()` | 保存 Profile |
| `admin-site` | `adminSite()` | 保存 Site |
| `admin-thought-config` | `adminThoughtConfig()` | 保存 Thoughts 置顶配置 |
| `admin-media` + `{ q, page }` | Media 库 `listMedia({ q?, page? })` | 上传、删除（统一失效 `['admin-media']` 前缀） |

只失效受影响的资源 key，不使用全局清缓存替代资源级更新。

## 6. 配置、命令和构建

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_CORE_URL` | `http://localhost:8080` | Core API 地址 |
| `VITE_WEB_URL` | `http://localhost:3000` | 公开站点地址，用于内容行的“在 Web 打开”外链 |

```bash
pnpm --filter @manifold/admin dev
pnpm --filter @manifold/admin typecheck
pnpm --filter @manifold/admin lint
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

根目录 `pnpm browser-test` 会启动隔离 Core/Web/Admin，验证登录、stats、反应、评论提交与回复、软删除和恢复，以及 Writings/Thoughts 的二级页面流程：列表搜索、hash 路由跳转、slug 建议、Meta/Context/Render 三 Tab、vditor 输入保存为 Markdown、Render Tab 与 Web 阅读面同构（标题/正文/TOC）、aiAssisted/summary 保存、发布 Popover、锁定态切换、dirty 离开确认和行内删除 Popover。

## 7. 修改规则

修改工作区 API、字段或状态时：

1. 先更新 `packages/contracts` 和 `packages/sdk`，再更新工作区。
2. 同步本文、`docs/core.md` 和 Web 文档中受影响的调用方。
3. 更新对应 query key、错误态、loading 态和浏览器验收。
4. 新增依赖时记录用途、包体和替代方案；当前 Markdown 渲染依赖的用途见 `docs/decisions/web.md`，vditor 与 `@manifold/render` 的同步规则见下。

**vditor（^3.11）**：Context tab 的写作编辑器，IR 模式提供 MarkText 式所见即所得输入，产出纯 Markdown；替代方案 milkdown（更重、插件生态更碎）与 CodeMirror 裸编辑（无即时渲染）。包体约 +360KB gzip 进入 admin chunk；运行时资源（lute wasm、图标、语言包）由 `scripts/sync-vditor.mjs` 本地化到 `public/vditor/`，不依赖第三方 CDN，且被 PWA precache 排除（`workbox.globIgnores`）。安全边界：编辑器只是输入辅助，产出的 Markdown 在渲染边界（`@manifold/render` 的 `MarkdownContent`）统一 sanitize。

**@manifold/render**：Web 与 Admin 共用的阅读面渲染包（`MarkdownContent`/`ReadingShell`/`ArticleSurface`/`ThoughtSurface` 等）。修改渲染必须在包内进行并按 `packages/render/README.md` 同步验证两端，禁止在 Web/Admin 复制渲染逻辑或样式。

管理控件优先使用 Mantine/Lucide，保持键盘访问、loading、error、empty 状态；设计令牌遵循 `docs/design-system/`。
