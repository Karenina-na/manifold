# Admin 当前契约

> 本文是 `app/admin` 当前实现的权威说明。工作区、Core API 调用、query key、表单字段、认证或构建边界变化时必须同步本文。

## 1. 背景与边界

`app/admin` 是单一 owner 使用的私有管理端，负责登录、统计、Profile、Writings/Thoughts 发布、评论管理（隐藏/取消隐藏、软删除/恢复和作者资料覆盖）、媒体、首页 composition 和 Agent 交互。它是独立的 Vite/React 应用，不复用 Web 页面组件、不访问 Core SQLite、不复制 Core 业务规则。

Core 负责最终鉴权和状态转换；Admin 只持有 session token，组织表单、查询缓存和用户反馈。

根目录 `pnpm dev` 使用开发 supervisor 同时托管 Web 和 Admin；任一前端异常退出（包括退出码 143）会按退避自动重启，同一服务连续 5 次立即失败后停止重启并打印原因（运行满 60 秒后失败计数清零），逃逸的 unhandled rejection 会先回收两个前端进程组再退出。直接运行 Admin 工作区命令时由调用方负责进程重启。

## 2. 技术架构

```text
Vite + React 19
├── app/App.tsx: session / Login / Sidebar / lazy workspaces
├── Mantine 9: controls and feedback
├── React Hook Form + Zod: form boundary
├── TanStack Query: server state and invalidation
├── Recharts: Dashboard chart
├── Lucide React: actions and navigation icons
├── vditor (IR mode): Context tab markdown editor
├── @manifold/render: shared reading surface for the Render tab
├── AgentDialog: session history + SSE reasoning/tool/content events
├── vite-plugin-pwa: manifest / service worker
└── @manifold/sdk -> Core /api/v1/admin
```

主要模块：`src/app/App.tsx` 管理登录、hash 路由（`#/writings`、`#/writings/{id}`、`#/writings/{id}/comments?…` 等二级页面，支持 hash query）和未保存离开确认，`src/app/ErrorBoundary.tsx` 负责渲染恢复；`src/lib/api.ts` 创建 SDK client，`src/lib/` 还提供 hash 路由、dirty 守卫和观测基础设施——`dirty-guard.ts` 既供 `requestNavigate` 在站内跳转前查询未保存状态，也在模块加载时注册一个 `beforeunload` 监听（`hasUnsavedChanges()` 为真时 `preventDefault()`），覆盖刷新、关标签页这类不经过站内导航代码路径的离开方式；持有脏表单的四个工作区（`workspaces/ProfileWorkspace`、`features/settings/SettingsWorkspace`、`workspaces/WritingsWorkspace`、`workspaces/ThoughtsWorkspace`）都必须注册 `setDirtyGuard` 并在卸载时清除，`dirty-guard.test.mjs` 以"任何读取 `formState.isDirty`（实例名可为 `form`/`profileForm`）的文件都必须调用 `setDirtyGuard`"的不变量钉住这条接线。浏览器 hash 后退/前进只触发 `hashchange`，既不触发 `beforeunload` 也不经过 `requestNavigate`，因此 `useHashRoute.ts` 自己注册 `hashchange` 监听，判定逻辑抽到无 DOM 依赖的 `lib/hash-guard.ts`（`hash-guard.test.mjs` 钉住各分支）：自身写入产生的 hash（mark 按值匹配而非布尔标记，避免一次空写入遗留的 mark 被下一次真实手势消费）、未脏、以及未注册确认 Modal 三种情况直接应用；脏表单且确认 Modal 已注册时用 `history.replaceState` 把 URL 退回 UI 实际所在的 hash，并把尝试的目标交给与站内导航同一个确认 Modal 决定是否丢弃（`replaceState` 不触发 `hashchange`，不会回环）。`src/components/common/`、`src/components/content/`、`src/components/forms/` 分别放跨工作区控件、内容编辑器族和表单输入，`src/features/settings/` 聚合 Settings 页面、校验 schema 与安全面板，`src/workspaces/` 保留 Dashboard、Profile、Writings、Thoughts、Media 和 Comments 页面；组件文件用 PascalCase，工具与 hook 用 kebab-case。

Dashboard、Profile、Writings、Thoughts、Media、Comments、Settings 通过 lazy chunk 加载，登录壳同步加载。

顶部栏 Agent 按钮打开居中的模态对话框，不新增 hash 路由。对话框从顶部渐入，背景使用半透明遮罩与 blur；通过 `agentMessages()` 恢复当前 session 的 user/assistant 历史和 assistant `trace`，通过 `runAgent()` 消费 SSE。每轮对话绑定自己的回答、运行轨迹和 token 用量；`reasoning.started/completed` 显示为紧凑状态步骤，不展示隐藏推理文本，运行完成后轨迹仍保留并显示 **Thought through/已思考**，默认收起但可再次展开；`tool.started/completed` 显示可折叠的工具名、输入与输出，`content.delta` 累加到对应 assistant 消息，`max_tokens` 会标记输出已截断。每个 user/assistant 气泡右下角提供 Copy；仅 user 气泡提供 Undo。Undo 调 `undoAgentMessage(userMessageId)`，由 Core 删除该用户消息及后续轮次，并把返回的 `draft` 放回 composer 供修改。运行中禁用 Undo。对话不进入 TanStack Query：流式状态由对话框局部 state 管理，Core session memory 才是跨开关对话框的权威；关闭模态或登出会通过 `AbortSignal` 取消未完成的流，异常 EOF 会显示为未完成运行。清空按钮调用 `clearAgentMessages()`。

Admin UI 支持英语与简体中文。`src/i18n/` 维护 `en`/`zh-CN` 资源，`react-i18next` 提供组件翻译；初始语言优先读取 `localStorage` 的 `manifold.locale`，其次读取浏览器语言，最后回退英语。语言切换器位于登录页工具栏和登录后的顶部栏，会即时更新 `document.documentElement.lang` 并持久化偏好；存储不可用时仍保持当前会话内语言。Mantine 日期组件、Vditor 工具栏、日期/数字格式和 `@manifold/render` 预览随同一 locale 切换，不复制渲染包文案。

## 3. 登录和会话

登录表单使用 React Hook Form + Zod，调用 `POST /api/v1/admin/session`。成功后把 `accessToken`、用户名和本地过期时间存到 `sessionStorage` 的 `manifold.admin.session`。

- 页面初始化时读取 session；过期或缺失则显示登录页。
- SDK 自动发送 `Authorization: Bearer <token>` 和 `X-Trace-ID`。
- Core 返回 `ApiError`，UI 显示稳定的用户提示；不要在 Admin 重新实现 JWT 验证。
- 当前只有 `admin` 角色，没有注册、角色管理或多用户 UI。
- **Sign out** 先调 `POST /api/v1/admin/session/logout`（fire-and-forget，失败不阻断）再清 `sessionStorage` 回登录页；Core 端吊销该会话后同 token 再请求返回 401。
- **改密码**（Settings 的 Security 区）调 `POST /api/v1/admin/password`；成功后 Core 吊销除当前外所有会话。
- **Sign out everywhere**（Settings 的 Security 区）调 `POST /api/v1/admin/session/logout-all`；成功后吊销其他设备会话并登出本机。

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

Refresh 按钮同时 refetch 四个 query。

### Profile

三栏工作台：左侧分区锚点导航（Identity / Links / Interests / CV / Series / Contact）+ 中间分组表单 + 右侧实时预览（随输入渲染公开首页的简化版，Admin 自绘，不依赖 Web 组件）。窄屏（<1180px）隐藏导航，<900px 时预览移到表单下方。

`GET/PUT /api/v1/admin/profile`，包含 displayName、handle、headline、bio、avatarUrl、location、organization、websiteUrl、resumeUrl、interests、education、experience、series、contacts。表单为结构化编辑器（react-hook-form `useFieldArray` + 嵌套 zod，行级错误落位）：

- interests 使用 chip 输入（Enter/逗号添加、× 移除、Backspace 删除末项）；
- education/experience/series/contacts 为可增删、上下排序的行编辑器，不再手写 JSON；
- education/experience 的 period 用两个日历月选择器（`@mantine/dates` `MonthPickerInput`，月份粒度、`valueFormat="YYYY-MM"`、上限今天）分别选 From/To；To 留空表示开放区间。现有模型仍是 `period: string`，因此 Admin 复用 `@manifold/render/period.ts` 的最小兼容格式：写入始终使用默认 locale 生成稳定的规范值 `2020 - Now`（`Now` 在这里是协议 token，不随 UI 语言改变，也不会写入“至今”），表单提示和预览再按当前 locale 显示 `Now`/`至今`；读取到旧版 `2020 - 至今` 时会解析并规范化，其他旧自由文本（如 `Ongoing`）保持只读并提供 Edit/Clear 切换；
- contacts 每行带图标网格 picker（品牌图标用 react-icons 的 si/fa6，如 GitHub/QQ/微信/WhatsApp/Telegram/YouTube/Bilibili/LinkedIn/掘金/知乎/小红书…；通用图标仍用 lucide；空 = globe 兜底），行内实时提示公开渲染结果；图标词汇表与 `resolveContactKey` 启发式统一收在 `@manifold/render` 的 `contact-icon.ts`/`contact-icon-ui.tsx`，Admin 与 Web 渲染端共用同一份，不再各自维护；
- 校验分工：zod schema 是 UX 层的即时反馈，不是权威——同一组长度与 URL scheme 规则由 Core 在 `PUT /admin/profile` 上独立执行（字段清单与上限见 `docs/core.md` §6），绕过表单的调用方同样被约束，Core 返回的 422 消息直接落位到表单；avatar/website/resume 允许空或 http(s)，contacts/series URL 必填且为 http(s) 或 mailto；headline/bio 显示字符计数；
- Avatar URL 与 Resume PDF URL 支持直接上传：Avatar 接受图片（png/jpeg/webp/gif/avif），Resume 接受 PDF，上传后把 Core 返回的 `media.url` 写回表单并短暂提示“已上传”；有值时可点眼睛在新标签页预览；
- 表单脏状态（isDirty）出现底部 sticky 保存条（Unsaved changes · Save/Discard），保存成功后按钮短暂显示 Saved。

预览面板按滚动位置切分：`IntersectionObserver` 跟踪六个表单区块，右侧 sticky 面板只渲染当前聚焦节的预览块（Introduction / Website and resume / Interests / Background / My Series / Contact），标题同步切换，避免 Background 内容多时整条预览过长。query key 维持 `['admin-profile']`，保存成功后失效。

### Writings

Writings 工作区为二级页面结构，路由走 hash：列表页 `#/writings`，详情页 `#/writings/new`（新建）与 `#/writings/{id}`（编辑/查看）。固定 `kind: 'ARTICLE'`，列表由共享 `ContentListPanel` 驱动，调用 `adminContent({ kind: 'ARTICLE', status?, q?, sort?, page? })`，query key 为 `['admin-content', 'ARTICLE', { status, q, sort, page }]`（失效仍走 `['admin-content']` 前缀）。列表页为全宽单栏：顶部工具栏（搜索 `q` 300ms 防抖、状态 chips All/Drafts/Published、排序 newest/oldest/updated、总数），下方行列表 + 服务端分页；行内容镜像 Web 归档卡（状态点、标题、`✦` summary 或派生 excerpt、日期、tags、views/likes/comments），行内操作为编辑（整行点击跳详情，行本身是 `role="button"` + `tabIndex={0}` 的可聚焦容器：Enter/Space 触发编辑、忽略来自行内按钮与外链的冒泡按键，`:focus-visible` 给出 outline 指示——行不能改写成 `<button>`，因为内部还嵌着按钮和链接）、pin（已发布项的图钉按钮，已置顶显示 Pinned 徽标与取消按钮，走 `updateWritingConfig`）、发布/撤回、删除和已发布项“在 Web 打开”外链（`VITE_WEB_URL`，默认 `http://localhost:3000`）；发布/撤回/删除均为 `ConfirmButton` 的内联 Popover 二次确认（不再使用 Modal）。编辑器 Meta tab 顶部同时提供 “Pin to the writings archive” 开关，与列表按钮共享同一 mutation。

| 操作 | SDK/Core |
| --- | --- |
| 列表 | `adminContent({ kind: 'ARTICLE', status?, q?, sort?, page? })` |
| 单条读取 | `adminContentItem(id)` → `GET /api/v1/admin/content/{id}`（详情页刷新/深链恢复） |
| 创建草稿 | `createContent(ContentInput)` |
| 编辑 | `updateContent(id, UpdateContentInput)` |
| 发布/撤回 | `publishContent(id)` / `unpublishContent(id)`（列表行与详情页头均可） |
| 删除 | `deleteContent(id)`（`ConfirmButton` Popover 二次确认），Core 返回 204 |

详情页由共享 `ContentEditorShell` 渲染：顶部返回链接（dirty 时经 App 确认 Modal）、状态标签、发布/撤回（Popover 确认）、Web 外链和删除；标题区带 **编辑态/锁定态切换**——查看已有内容默认锁定（`<fieldset disabled>` 整体只读，chips 移除按钮隐藏），点 Edit 解锁，点 Lock 且存在未保存修改时弹确认（放弃修改并锁定）；新建直接进入编辑态，首次保存后 `history.replaceState` 换成 `#/writings/{id}`（不产生回退步骤）。内容区分三个 Mantine Tab：

- **Meta（元信息）**：表单 `#writing-form`，按 Web 可见性分组——title、slug、summary、tags、language 与 `aiAssisted`；阅读时长和 TOC 由 Core 派生，保存使用完整 PUT payload。
- **Context（正文）**：vditor IR（instant-rendering，MarkText 式）全宽编辑器，输入即得纯 Markdown 存入表单 `body`；锁定态经 `fieldset disabled` + `editor.disabled()` 只读。vditor 通过 `cdn: '/vditor'` 从 Admin 自身加载 lute/图标/语言包（`scripts/sync-vditor.mjs` 在 dev/build/browser-test 前把 `node_modules/vditor/dist` 的子集复制到 `public/vditor/`，gitignore 掉产物）；编辑器内部预览不求渲染公式/图表/代码高亮，权威渲染以 `@manifold/render` 为准。**GFM 扩展工具栏**：编辑器在 `table` 与 `undo` 之间插入 renderer 已支持的扩展入口——Callout 下拉（vditor 原生 `menuItem.toolbar` 子菜单，五项 NOTE/TIP/IMPORTANT/WARNING/CAUTION，选择后插入 `> [!TYPE] text`，子项图标内嵌文字标签）、Footnote（选中词追加 `[^N]`，N 由现有源扫描到的最大编号 +1 得到、避免重复，定义以 `[^N]: ` 追加到文末；光标处的引用与文末定义分离。编辑器内显示的脚注编号由 lute 按**定义出现顺序**生成，`@manifold/render` 采用同一规则，因此两端编号一致；`[^…]` 标识符只用于引用与定义配对，不参与编号与锚点 id，手工改号时引用与定义必须同步改，只改一处时该引用按 GFM 退化为字面文本（两端一致））、Keyboard key（`<kbd>…</kbd>` 包裹）、Highlight（`<mark>…</mark>` 包裹，`wrapSelection` 文本级 Range 替换，无选区时插入转义占位符）与 Diff block（```` ```diff ```` 模板）。编辑器开启 `mark: true` 让 lute 识别 mark 语法；IR 模式对行内 raw HTML（mark/kbd）按 vditor 设计显示为语法标记（`data-type="html-inline"` 的 mono 芯片），最终高亮语义由 `@manifold/render` 承担。工具栏图标为 lucide 风格内联 SVG，均带 `style="stroke-width:2"` 以抵消 vditor 的 `stroke-width:0` 规则（否则线框图标不可见）。**图片上传**：粘贴、拖拽和工具栏“Upload image”按钮（触发隐藏 file input）都经 `upload.handler` 调用 `uploadMedia(file, file.name)`，成功后由编辑器 `insertValue` 插入 `![文件名](绝对 url)`；vditor handler 的返回值只是 tip 文案（不为内容插入），类型白名单外的文件与上传失败经 `vditor.tip(...)` 呈现；Writings/Thoughts 通过 `onUploadImage` 注入同一 `uploadMedia` 通路；
- **Render（渲染的）**：直接复用 `@manifold/render` 的 `ArticleSurface`（标题块、meta 行、TOC、`MarkdownContent` 正文），与 Web 阅读面同源组件；外层包 `.articleSurface/.articleSurfaceInner` 容器（Admin 侧收起横向内边距）。ArticleSurface 不传 rail slot，ReadingShell 自动切到 `no-rail` 网格——正文列（≤860px）与 220px TOC 并列居中，≤1300px 时 TOC 变为顶部横带；标题块随正文同列对齐。Context tab 的编辑器限宽 860px 居中，与正文列视觉一致。

保存使用底部 sticky save bar（仅编辑态且 dirty 时出现；`Cmd/Ctrl+S`/`Cmd/Ctrl+Enter` 触发）。因为 Tab 面板 `keepMounted={false}` 会在切换时卸载表单，SaveBar 按钮与快捷键都通过 workspace 传入的 `onSubmitRequest`（RHF `handleSubmit` 回调）提交，并短暂让出事件循环以收集 vditor 防抖中的最后输入。保存成功后停留在详情页并更新 version；409 版本冲突弹 “Saved elsewhere” Modal 提供重载。详情页数据来自 `['admin-content-item', 'ARTICLE', id]`。

### Thoughts

Thoughts 工作区为同构的二级页面（`#/thoughts`、`#/thoughts/new`、`#/thoughts/{id}`），固定 `kind: 'THOUGHT'`，列表调用 `adminContent({ kind: 'THOUGHT', status?, q?, sort?, page? })`，query key 为 `['admin-content', 'THOUGHT', { status, q, sort, page }]`。操作表与 Writings 相同，pin 走 `updateThoughtConfig`（列表图钉按钮 + 编辑器 Meta tab 开关，已置顶显示 Pinned 徽标）。

Meta tab 字段：正文在 Context tab（vditor IR）必填；title、slug 可选（slug 为空时 Core 使用 ID，更新时置空即清除）；summary（`✦` 标记，Web 卡片与详情均渲染）；tags（chip 输入）；溯源组按 Web 图标语义分组——mood（Sparkles）、question（反引 blockquote）、context（Compass）、source（BookOpen）。Render tab 直接复用 `@manifold/render` 的 `ThoughtSurface`（含 ReadingProgress）。保存条、锁定切换、快捷键、vditor 提交时序与 409 处理与 Writings 一致；详情数据来自 `['admin-content-item', 'THOUGHT', id]`。

共享模块：`lib/useHashRoute.ts`（hash 解析/导航/受守卫的 `requestNavigate`）、`lib/dirty-guard.ts`（编辑器注册 dirty 检查，App 侧栏与返回链接共用确认 Modal）、`@manifold/render` 的 `content-derive`（excerpt/阅读时长/TOC 的共享纯函数）、`components/content/ContentListPanel.tsx`（列表面板、可聚焦行（`role="button"` + Enter/Space）、状态/排序/分页）、`components/forms/ChipsInput.tsx`（标签 chips 输入）、`components/content/SaveBar.tsx`（未保存横条与跨 Tab 提交按钮）、`components/content/ContentEditorShell.tsx`（详情页壳：三 Tab、锁定切换、状态操作、409 Modal）、`components/common/ConfirmButton.tsx`（Popover 内联二次确认，支持 icon-only）与 `components/content/MarkdownEditor.tsx`（vditor IR 封装：初始化就绪门槛 `after()`、`input`/`setValue` 值桥、锁定 `disabled()/enable()`；GFM 扩展工具栏经 `gfmToolbar()` 生成，只写 Markdown 源——Callout/脚注/kbd/mark/diff 的最终渲染语义与清洗都在 `@manifold/render`，编辑器不做 HTML 承诺）。`ProfileWorkspace` 的 interests chip 输入复用同一 `ChipsInput`；Admin 日期、时间和数字展示统一使用 `src/i18n/format.ts` 并显式传入当前 locale。

规则：所有更新带 `expectedVersion`；新建总是 DRAFT；两个内容工作区的写入失效统一使用 `['admin-content']` 前缀并同步失效 `admin-overview`（Thoughts 另失效 `admin-thought-config`，保证置顶选择器同步）。

### Media

侧栏 Media 项路由 `#/media`（`MediaWorkspace.tsx`）。列表来自 `listMedia({ q?, page? })`，query key `['admin-media', { q, page }]`（失效统一 `['admin-media']` 前缀）：搜索防抖 300ms，`page`/`pageSize` 分页，按 `createdAt` 降序。上传入口三个——拖放区、点击区（隐藏 file input）、编辑器（见 Context tab）；经 `uploadMedia(file, file.name)` 逐个上传，白名单 png/jpeg/webp/gif/avif 图片与 PDF，失败（超限 413、类型 415 等）在 dropzone 下方的 Alert 呈现 `error.message (code)`。卡片网格（图片缩略图 / PDF 占位卡、mime/体积/日期），每张卡提供 **Details**（进入二级详情页）、**Copy markdown**（图片写入 `![filename](url)`，PDF 写入 `[filename](url)`，2.4s 内回显 Copied）和 ConfirmButton Popover 删除（`deleteMedia` → 204 后失效列表）。删除失败时在 dropzone 下方 Alert 展示原因：Core 返回 409 `MEDIA_IN_USE` 时提示 "This image is used in published or draft content. Remove those references first."（Core 已做引用校验，被引用的媒体拒绝删除并附 `details.references`）。发布正文里的图片由 `@manifold/render` 直接渲染。

二级详情页路由 `#/media/{mediaId}`：基本信息来自 `listMedia({ q: mediaId, pageSize: 50 })` 按精确 id 取项（query key `['admin-media-item', mediaId]`，不失效——不可变）；引用列表来自 `mediaReferences(mediaId)`（query key `['admin-media-references', mediaId]`）。布局为顶部大预览（图片/PDF 占位）→ 基本信息卡（mime/体积/上传时间/ID + Open preview + Copy markdown + Delete）→ **Used by** 引用列表：每行显示状态点（Draft/Published）、标题（无标题显示 Untitled writing/thought）、类型与 slug，点击跳转对应编辑页（`#/writings/{contentId}` 或 `#/thoughts/{contentId}`）；空状态提示 "No published or draft content references this file."。返回用 `requestNavigate('#/media')`，受未保存离开守卫保护。

### Comments

`adminComments({ q, page })` 读取线程分页的管理评论（含已软删和隐藏行，顶层评论降序，行内附 `contentTitle`/`contentKind`、`deletedAt`/`hiddenAt`）；顶部搜索 300ms 防抖后走服务端 `q`。每行展示作者、回复标记、内容类型徽标、正文、日期和 moderation 状态；隐藏/取消隐藏分别调用 `POST .../hide` 与 `POST .../unhide`，删除走 `ConfirmButton` 二次确认（`DELETE /api/v1/admin/comments/{id}`，204），恢复为直接操作（`POST .../restore`，204）。点击行跳转到所属内容编辑页的 Comments tab 并带 `?focus={commentId}`，由 Core 把该评论定位到其线程所在分页；跳转遵守 dirty 离开确认。操作后失效 `admin-comments`、`admin-overview` 和 `admin-content`。

### 编辑器 Comments tab

Writings/Thoughts 编辑页在 Meta/Context/Render 之外提供 Comments tab（新建内容不显示）。`ContentCommentsPanel` 按线程展示当前内容的评论：顶层评论行内可 Reply、Hide/Unhide、Delete/Restore，并可通过小弹窗编辑 `authorName`/`authorUrl`/`avatarSeed`；composer 以 Profile displayName 预填作者名，作为站点作者发出，清空则 Core 归一化为 `Anonymous`。tab 的 `page/q/focus` 状态镜像到 hash（`#/writings/{id}/comments?page=2&q=…`），focus 命中后滚动高亮该行并从 URL 摘除。评论 tab 与内容编辑状态无关（锁定只影响 Meta/Context 的表单）。创建、隐藏/取消隐藏、作者资料更新、删除/恢复后失效 `admin-comments`、`admin-overview`、`admin-content`。

### Settings

Site 调用 `GET/PUT /api/v1/admin/site`，对整个站点设置做结构化表单（`src/features/settings/siteSettingsSchema.ts` 为唯一 Zod schema 与 `SiteSettingsForm` 类型源）：

- **Identity**：`title`（必填 ≤80）、`description`（≤200）、`footer`（≤200）和 `social`（≤6 项，`LinkRowsField` 行编辑：label/href/"Opens in a new tab" 复选框 + 上下移/删除）。
- **Navigation**：同一 `LinkRowsField`，1..10 项，替换历史上的 JSON textarea。
- **Comments**：`commentsEnabled` Switch，关闭后 Core 公开评论接口返回 403、Web 隐藏评论区。
- **Homepage**：`sections` 用 section-picker 编辑（六区块枚举开关 + 上下移排序，至少保留一个）。首页内容列不做置顶策划，始终按发布时间展示；内容置顶属于各自内容工作区（见下）。

站点设置是单个全量 PUT（一个保存条、`['admin-site']` 失效）。内容置顶（pin）在各自工作区设置：Writings 用 `['admin-writings-config']` + `updateWritingConfig`，Thoughts 用 `['admin-thought-config']` + `updateThoughtConfig`；Core 校验非空引用必须是已发布的对应类型内容。

同一 Settings 页面包含独立的 **Agent** panel，使用 `GET/PUT /api/v1/admin/agent/settings` 与 query key `['admin-agent-settings']`。表单管理 OpenAI Provider、模型、最大工具回合、上下文历史条数、最大输出 token 与 Base URL；Base URL 保存时会清理首尾空白、去掉尾部斜杠，并在路径中缺少 `v1` 时自动补齐 `/v1`；这些值保存后从下一次 Agent 运行起生效。API key 是只写字段：留空保留已有值，输入新值替换，勾选清除则提交 `null`；GET 和 PUT 响应只返回 `apiKeyConfigured`。Agent 表单有独立保存按钮，同时向 Settings 的 dirty guard 报告未保存状态。

### Security

Settings 底部的独立 panel（`features/settings/SecuritySection.tsx`），不属于站点设置表单：

- **改密码**：current + new + confirm 三个 `PasswordInput`（Zod 校验 ≥8 且两次一致），调 `changePassword`；成功后按钮 2.4s 回显 "Password updated"，失败 Alert 提示检查当前密码。Core 端成功后吊销其他设备会话，当前会话保持有效。
- **Sign out everywhere**：调 `logoutAllSessions`，成功后回显 "Sessions revoked" 并回调 `onLoggedOut`（由 `App.tsx` 清 session 回登录页）。

## 5. Query key 和失效

| Query key | 来源 | 写入后失效 |
| --- | --- | --- |
| `admin-overview` | `adminOverview()` | Dashboard 手动刷新 |
| `admin-analytics` + days | `adminAnalyticsViews({ days: 30 })` | Dashboard 手动刷新 |
| `admin-system` | `adminSystem()` | Dashboard 手动刷新 |
| `admin-comments` | `adminComments({ q, page })`（Comments 工作区）、`adminComments({ contentId, q, page, focus })`（编辑器 Comments tab）、`adminComments({ pageSize: 50 })`（Dashboard 最近评论） | 隐藏/取消隐藏、作者资料更新、软删除/恢复评论、发布评论、Dashboard 手动刷新 |
| `admin-writings-config` | `adminWritingConfig()`（Writings 列表与编辑器共享） | 置顶/取消置顶 Writing |
| `admin-thought-config` | `adminThoughtConfig()`（Thoughts 列表与编辑器共享） | 置顶/取消置顶 Thought |
| `admin-audit` + page + q | `adminAudit({ page, pageSize: 10, q })` | Dashboard 手动刷新 |
| `admin-content` + `ARTICLE` + `{ status, q, sort, page }` | Writings 列表 `adminContent({ kind: 'ARTICLE', … })` | 内容创建、更新、发布、撤回、删除（统一失效 `['admin-content']` 前缀） |
| `admin-content` + `THOUGHT` + `{ status, q, sort, page }` | Thoughts 列表 `adminContent({ kind: 'THOUGHT', … })` | 同上 |
| `admin-content-item` + kind + id | 详情页 `adminContentItem(id)` | 单条保存、发布/撤回后直接 setDraft 更新；重载时失效该 key |
| `admin-profile` | `adminProfile()` | 保存 Profile |
| `admin-site` | `adminSite()` | 保存 Site（全量 PUT，含身份/social/评论开关/首页组合） |
| `admin-agent-settings` | `adminAgentSettings()` | `updateAgentSettings()` 保存 Agent 模型、运行上限、Base URL 与只写 API key |
| `admin-thought-config` | `adminThoughtConfig()` | 保存 Thoughts 置顶配置 |
| `admin-media` + `{ q, page }` | Media 库 `listMedia({ q?, page? })` | 上传、删除（统一失效 `['admin-media']` 前缀） |
| `admin-media-item` + mediaId | 详情页基本信息 `listMedia({ q: mediaId, pageSize: 50 })` 精确 id 取项 | 不失效（媒体不可变） |
| `admin-media-references` + mediaId | 详情页引用列表 `mediaReferences(mediaId)` | 不失效（引用只随内容增删，离开详情页重建） |

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
pnpm --filter @manifold/admin test
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

`test` 先执行 `node --test src/lib/*.test.mjs src/i18n/*.test.mjs`（纯 Node 的模块级回归测试，Node 22 直接加载 `.ts`，不需要额外转译或测试框架），再执行 `node --experimental-strip-types --test src/components/agent/*.test.mjs` 覆盖 Agent 对话轮次和工具 payload 展示逻辑，最后执行 `tsc -b` 作为类型门槛。`src/i18n` 用例覆盖 locale 解析、en/zh-CN 资源 key 一致性、显式 locale 格式化，以及登录页、错误页、设置页、全部工作区和共享页面组件的静态翻译 key/可见 JSX 文案覆盖。

根目录 `pnpm browser-test` 会启动隔离 Core/Web/Admin，验证登录、stats、反应、评论提交与回复、软删除和恢复，以及 Writings/Thoughts 的二级页面流程：列表搜索、hash 路由跳转、slug 建议、Meta/Context/Render 三 Tab、vditor 输入保存为 Markdown、Render Tab 与 Web 阅读面同构（标题/正文/TOC）、aiAssisted/summary 保存、发布 Popover、锁定态切换、dirty 离开确认和行内删除 Popover。

统一发布通过 `pnpm package:release -- --env .env.production` 构建 `dist`，并把 `VITE_CORE_URL`/`VITE_WEB_URL` 在构建时固化；`ADMIN_PUBLIC_URL` 记录独立域名反向代理下的 Admin 公开 origin。生产配置未提供管理员密码 hash 时，脚本生成随机初始密码、写回 bcrypt hash，并仅在当前终端显示一次明文。目标服务器不运行 `vite preview`；包内 Node 静态服务器在 `0.0.0.0:5173` 提供 GET/HEAD、MIME、SPA fallback 和路径约束，对 hash 资源使用 immutable cache，对 `index.html`、service worker 与 web manifest 使用 `no-cache`。Admin 公共交互和 Core API 契约未变。

## 7. 修改规则

修改工作区 API、字段或状态时：

1. 先更新 `packages/contracts` 和 `packages/sdk`，再更新工作区。
2. 同步本文、`docs/core.md` 和 Web 文档中受影响的调用方。
3. 更新对应 query key、错误态、loading 态和浏览器验收。
4. 新增依赖时记录用途、包体和替代方案；当前 Markdown 渲染依赖的用途见 `docs/decisions/web.md`，vditor 与 `@manifold/render` 的同步规则见下。

**vditor（^3.11）**：Context tab 的写作编辑器，IR 模式提供 MarkText 式所见即所得输入，产出纯 Markdown；替代方案 milkdown（更重、插件生态更碎）与 CodeMirror 裸编辑（无即时渲染）。包体约 +360KB gzip 进入 admin chunk；运行时资源（lute wasm、图标、语言包）由 `scripts/sync-vditor.mjs` 本地化到 `public/vditor/`，不依赖第三方 CDN，且被 PWA precache 排除（`workbox.globIgnores`）。安全边界：编辑器只是输入辅助，产出的 Markdown 在渲染边界（`@manifold/render` 的 `MarkdownContent`）统一 sanitize。

**@manifold/render**：Web 与 Admin 共用的阅读面渲染包（`MarkdownContent`/`ReadingShell`/`ArticleSurface`/`ThoughtSurface` 等）。修改渲染必须在包内进行并按 `packages/render/README.md` 同步验证两端，禁止在 Web/Admin 复制渲染逻辑或样式。

管理控件优先使用 Mantine/Lucide，保持键盘访问、loading、error、empty 状态；设计令牌遵循 `docs/design-system/`。
