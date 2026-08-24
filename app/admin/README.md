# `app/admin`：Manifold 管理端

## 项目背景

`app/admin` 是 Manifold 的私有发布和运营工作台。它服务单一 owner 账号，负责把公开站点背后的内容、评论、当前状态和身份配置变成可操作的管理流程。

Admin 与 Web 是两个独立应用：

- 不复用 Web 的路由、组件或状态。
- 不读取 Core SQLite，只通过 `@manifold/sdk` 调用 `/api/v1/admin`。
- Core 决定 JWT 和 `admin` 角色权限，Admin 只保存和发送 session token。
- 写操作成功后通过 TanStack Query 失效相关 query，让列表、统计和设置重新读取 Core。

## 管理对象和工作流

### 登录与会话

登录页使用 React Hook Form + Zod 校验，调用 `POST /api/v1/admin/session`。成功响应中的 access token、用户名和过期时间保存到 `sessionStorage` 的 `manifold.admin.session`。

应用启动时读取 sessionStorage：

- token 未过期：进入管理壳。
- 没有 token 或 `expiresAt` 已过期：回到登录页。
- 登出：删除 sessionStorage 并清空本地 session。

当前 Core 只配置一个 `admin` 角色，没有注册、多角色 UI 或账号管理。

### Dashboard

Dashboard 请求 `GET /api/v1/admin/stats`，展示 Core 计算的：

- 已发布内容总量、字数和分类数量。
- 待审核评论数量。
- 按 Technology、Thought、Manuscript 分类的 Recharts 柱状图。

Dashboard 不在浏览器重新统计文章或字数；刷新按钮只重新请求 Core。

### Content 工作区

Content 工作区通过 `adminContent` 读取内容列表，并将 kind/status 筛选传给 Core：

编辑器按内容类型分流，不共享一套无差别字段：Technology 编辑技术栈、语言、难度和仓库地址；Thought 编辑情绪、问题和上下文；Manuscript 编辑体裁、阶段和字数。提交时三组字段分别编码为 Core `metadata` 的判别结构，编辑已有记录时从 metadata 回填。

- kind：All、Technology、Thought、Manuscript。
- status：All、Draft、Published、Deleted。
- 选中非 Deleted 内容后在右侧编辑器打开。
- 新建内容时在 Thought 快速输入和 Writing 长文编辑之间切换；Writing 支持阅读时长、frontmatter 和技术标签。
- 编辑内容时 slug/kind 不可改，提交 `expectedVersion`。
- 新建结果是 DRAFT。
- Draft 可发布，Published 可撤回到 Draft，非 Deleted 内容可软删除。

版本冲突由 Core 返回 `409 VERSION_CONFLICT`，客户端不应绕过 expectedVersion。

### Comments 工作区

Comments 只查询 `PENDING` 队列：

- 显示作者、日期、正文和 content ID。
- Approve 调用 `POST /comments/:id/approve`。
- Reject 调用 `POST /comments/:id/reject`。
- 成功后同时失效 `admin-comments` 和 `admin-stats`，队列行消失，Dashboard 待审数更新。

公开 Web 只有在 Core 返回 `APPROVED` 后才能读到评论，Admin 的批准是发布链路中的状态转换。

### Now 工作区

Now 工作区读取 `/api/v1/now`，编辑标题、详情和 mood，再通过 `PUT /api/v1/admin/now` 更新。成功后失效 `now` query，让下次读取反映 Core 的时间戳。

### Settings 工作区

Settings 分成三个配置域：

- **Profile**：display name、handle、headline、bio、avatar URL、location、organization、website URL。
- **Site navigation**：导航 JSON 和 sections，限定在首页、Technology、Thoughts、Manuscripts。

表单在浏览器使用 Zod 做格式校验，Core 仍会再次做服务端校验。Profile 和 Site 各自拥有独立 query key，写入成功只失效对应资源。

## 技术架构

```text
Vite + React 19
├── App.tsx
│   ├── LoginScreen
│   ├── Sidebar / topbar
│   └── lazy workspace + Suspense
├── React Query
│   ├── admin stats
│   ├── content list/editor
│   ├── pending comments
│   ├── now status
│   └── profile/site settings
├── @manifold/sdk
│   └── ManifoldClient(token)
└── Core /api/v1/admin
              |
              v
       JWT + Casbin + SQLite
```

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 构建/运行 | Vite 8 + React 19 | 独立开发服务器和生产静态资源 |
| UI 控件 | Mantine 9 | 输入、选择、反馈、按钮、徽标和动作图标 |
| Server state | TanStack Query | 查询缓存、重试、mutation 和失效 |
| 表单 | React Hook Form + Zod | 登录、内容、Now、Profile、Site 校验 |
| 图表 | Recharts | Dashboard 按内容类型的柱状图 |
| 图标 | Lucide React | 导航和动作图标 |
| PWA | vite-plugin-pwa | manifest、service worker 和 precache |
| API | `@manifold/sdk` | Bearer token、统一错误和 Core 请求 |

## 目录与模块

```text
app/admin/
├── src/
│   ├── main.tsx                  # React root、MantineProvider、QueryClient
│   ├── App.tsx                   # session、登录、侧栏和 workspace 路由
│   ├── api.ts                    # Core URL、sessionStorage、Admin SDK client
│   ├── ErrorBoundary.tsx         # 全局渲染错误和 reload 恢复
│   ├── observability.ts          # trace ID 和客户端错误日志
│   ├── SettingsWorkspace.tsx     # Profile、Site
│   ├── workspaces/
│   │   ├── DashboardWorkspace.tsx
│   │   ├── ContentWorkspace.tsx
│   │   ├── CommentsWorkspace.tsx
│   │   └── NowWorkspace.tsx
│   ├── App.css                   # 管理壳、面板、响应式布局
│   └── index.css                 # 全局 token 和基础样式
├── public/                       # favicon、icons
├── vite.config.ts                # React、PWA、manifest 配置
├── index.html
└── package.json
```

`App.tsx` 只同步加载登录壳和导航；Dashboard、Content、Comments、Now、Settings 通过 `React.lazy` + `Suspense` 按视图加载，避免首屏同步载入图表和全部表单。

## 请求与缓存约定

`createAdminClient(token)` 使用 `VITE_CORE_URL` 创建 `ManifoldClient__。SDK 会：

- 将 token 转换为 `Authorization: Bearer <token>`。
- 每次请求发送 `X-Trace-ID`。
- 对非 2xx 响应抛出带 status、code、details、requestId 和 traceId 的 `ApiError`。
- 对 204 成功响应返回 `undefined`。

| Query key | 来源 | 失效时机 |
| --- | --- | --- |
| `admin-stats` | `adminStats()` | 评论审核后、Dashboard 手动刷新 |
| `admin-content` | `adminContent(query)` | 创建/更新/发布/撤回/删除后 |
| `admin-comments` | `adminComments("PENDING")` | Approve/Reject 后 |
| `now` | `now()` | 更新 Now 后 |
| `admin-profile` | `adminProfile()` | 保存 Profile 后 |
| `admin-site` | `adminSite()` | 保存 Site 后 |

服务端筛选优先：Content 的 kind/status 选择会组成 SDK query，不在前端拿全量数据后重新实现状态规则。

## 配置与运行

从仓库根目录：

```bash
pnpm install
pnpm --filter @manifold/admin dev
```

Vite 默认端口为 `5173`，Core 默认地址为 `http://localhost:8080`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_CORE_URL` | `http://localhost:8080` | Admin SDK 请求 Core |

根目录 `.env` 不会自动注入到 Vite；开发和部署环境需要显式配置。修改 `VITE_CORE_URL` 后需重启 Vite，因为 Vite 在构建时替换 `import.meta.env`。

生产构建会生成静态资源、PWA manifest、service worker 和 precache 文件：

```bash
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @manifold/admin dev` | Vite 开发服务器 |
| `pnpm --filter @manifold/admin build` | TypeScript 增量检查 + Vite/PWA 构建 |
| `pnpm --filter @manifold/admin preview` | 预览生产构建 |
| `pnpm --filter @manifold/admin typecheck` | `tsc -b` 类型检查 |
| `pnpm --filter @manifold/admin test` | 当前等价于 TypeScript 检查 |
| `pnpm --filter @manifold/admin lint` | Oxlint |
| `pnpm browser-test` | 根脚本真实浏览器联调 |

`pnpm browser-test` 会启动隔离 Core、Web、Admin 和临时数据库，使用默认测试账号完成：

1. Web 详情页加载。
2. LIKE 和 FAVORITE 请求返回 200。
3. 评论提交返回 201 并显示 Awaiting review。
4. Admin 登录和 stats 请求返回 200。
5. Comments 工作区看到新评论。
6. Approve 请求返回 204，队列变为 0 pending。
7. 控制台无错误并清理临时资源。

## 错误处理和可观测性

`AdminErrorBoundary` 包住整个 React root：

- 渲染异常转换为带 trace reference 的恢复页。
- 恢复动作执行 `window.location.reload()`，不修改 Core 数据。
- `reportClientError` 记录 `manifold.client_error`、scope、错误详情、component stack 和 trace ID。
- API 错误由 mutation/query 状态展示；服务端 code 和 trace 可从 `ApiError` 读取。

网络错误、过期 token 和服务端校验错误不是同一类问题：当前代码在初始化时检查 token 过期时间，自动运行中的 token 过期处理仍是后续扩展。

## 开发约束

1. Admin 只通过 `@manifold/sdk` 调用 Core，不直接拼接 URL 或读 SQLite。
2. 修改跨端请求/响应时先更新 `packages/contracts` 和 SDK，再改工作区。
3. 所有写操作成功后失效最窄的 query key；不要用全局清缓存代替资源级失效。
4. Content 更新必须带当前 `version` 作为 `expectedVersion`。
5. 不在 Admin 复制 Core 的统计、状态转换或权限判定；Core 是最终权威。
6. 新工作区使用 `React.lazy`，并提供 `Suspense` fallback。
7. 管理控件优先使用 Mantine 和 Lucide，保持键盘访问、loading、error 和空状态。
8. 修改工作区行为时同步本 README 和根脚本浏览器验收流程。

## 测试重点

| 范围 | 命令/文件 | 关注点 |
| --- | --- | --- |
| 类型 | `pnpm --filter @manifold/admin typecheck` | 表单、SDK 和 query 类型 |
| 构建 | `pnpm --filter @manifold/admin build` | Vite chunk、PWA 资源和 production 编译 |
| lint | `pnpm --filter @manifold/admin lint` | Oxlint 规则 |
| Core/SDK | `packages/sdk/src/index.test.ts`、`app/core/internal/handler/api_test.go` | Bearer、错误和状态码 |
| 浏览器 | `scripts/browser-check.cjs` | Web -> Core -> Admin 真实链路 |

## 当前边界

当前 Admin 只服务单一 owner，不提供用户管理、细粒度 RBAC、批量发布、排期、审计查询/导出、媒体资产或全文搜索。PWA 资源已生成，但离线编辑和离线写入没有实现；所有写操作仍要求 Core 在线。
