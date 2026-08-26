# Manifold Agent Guide

## 项目背景

Manifold 是一个 API-first 的个人数字花园，当前产品只围绕三类公开入口构建：Home、Thoughts 和 Writings。内容底层使用 Core 的单表模型：`THOUGHT` 表示碎记、方法论、阅读笔记和阶段性反思；`ARTICLE` 表示深度技术文章、算法实验复盘和系统架构方案。

仓库包含五个有明确边界的 workspace：

- `app/core`：Go REST API、鉴权、SQLite 持久化、缓存、审计和业务规则的唯一所有者。
- `app/web`：Next.js 公开阅读端，不持有业务数据。
- `app/admin`：Vite/React 私有管理端，不直接访问 SQLite。
- `packages/contracts`：跨端 TypeScript 请求/响应类型的唯一公共契约。
- `packages/sdk`：基于 `fetch` 的 Core HTTP 客户端，统一认证、追踪 ID 和错误解析。

## 架构约束

```text
Web / Admin
     |
     +--> packages/sdk --> app/core --> SQLite
     |        |
     +--------+--> packages/contracts
```

1. Core 是业务规则、数据状态和 API 响应的最终权威。
2. Web/Admin 不导入 Go 内部包，不读取 SQLite，不在客户端复制 Core 的发布、统计或权限判断。
3. 跨端类型先改 `packages/contracts`，HTTP 方法随后改 `packages/sdk`，消费者最后适配。
4. 公开 Markdown 必须在 Web/Admin 的渲染边界经过清洗；Core 存储 Markdown，不承诺其 HTML 安全。
5. 设计和布局遵循 `docs/design-system/` 的 token、排版、可访问性和响应式约束，不新增平行设计系统。
6. 当前不恢复 Projects、Technology、Manuscript 等已移出产品范围的入口；历史文档中的这些词必须标注为历史规划。

## 关键文档

| 文档 | 权威范围 | 何时必须同步 |
| --- | --- | --- |
| [`docs/core.md`](docs/core.md) | Core 架构、路由、请求/响应、数据模型、错误和运行配置 | Core 的 API、schema、校验、鉴权、缓存、审计、配置或生命周期变化 |
| [`docs/admin.md`](docs/admin.md) | Admin 工作区、API 调用、query key、表单和状态流 | Admin 工作区、表单、Core API 调用、缓存失效、登录或构建边界变化 |
| [`docs/decisions/web.md`](docs/decisions/web.md) | Web 当前页面、数据流、渲染器、交互和 SEO | Web 路由、页面数据、Markdown、评论/反应、SEO、设计或浏览器行为变化 |
| [`docs/web.md`](docs/web.md) | Web 契约摘要和阅读能力 | Web 公共行为或渲染能力变化；内容与决策文档保持一致 |
| [`packages/contracts/README.md`](packages/contracts/README.md) | TypeScript 类型、判别联合、请求输入和共享响应 | `packages/contracts/src/index.ts` 的任何导出变化 |
| [`packages/sdk/README.md`](packages/sdk/README.md) | SDK 方法、URL、HTTP、认证、错误和测试约定 | `packages/sdk/src/index.ts` 的任何方法或请求行为变化 |
| `app/*/README.md` | 项目背景、运行和开发入口 | 对应项目结构、命令、边界或运行方式变化 |
| [`docs/decisions/`](docs/decisions/) | 架构决策和历史背景 | 重大架构选择、依赖替换、数据模型或公共 API 决策 |


## 文档同步规则

### 修改前

1. 先阅读本文件和受影响项目的当前契约文档。
2. 判断变更是否改变了公共事实：路径、HTTP method、字段、枚举、状态、错误、环境变量、缓存语义、页面路由、query key、组件能力或依赖。
3. 如果改变了公共事实，先在同一变更中列出需要同步的文档，不允许把文档更新留给“后续整理”。

### 修改顺序

跨端 API 变更必须遵循：

```text
contracts -> sdk -> core -> web/admin -> docs -> tests
```

Core 内部实现只改变持久化、缓存或观测行为时，至少同步 `docs/core.md`；如果响应或调用方式没有变化，明确写出“公共契约未变”。

Web/Admin 只改变视觉细节时，仍需检查 `docs/design-system/`；只有路由、数据流、交互状态、依赖或约束变化时才更新对应契约文档。

### 修改后

- 文档必须描述当前实现，不得把规划 API 写成已实现。
- 删除或废弃 API 时，先在文档标记迁移方式和状态，再删除代码。
- 新增第三方库时，在对应项目文档记录用途、替代方案、包体/运行时权衡和安全边界。
- 修改 Core API 时，检查 `docs/core.md`、`docs/admin.md`、`docs/decisions/web.md`、`packages/sdk/README.md`、`packages/contracts/README.md` 是否仍一致。
- 修改共享类型或 SDK 时，至少检查所有调用方和上述五份契约文档。

## 注释规范

- 代码应优先通过清晰的命名和结构表达意图。
- 仅为复杂算法、非显而易见的业务规则、重要外部约束或临时兼容逻辑添加注释。
- 注释应说明“为什么”，不要重复代码正在做什么。
- 不添加空泛、逐行描述、过时或仅用于装饰的注释。
- 修改行为时同步更新受影响的注释。

## 验证门槛

提交前按变更范围运行：

```bash
go test -count=1 ./...       # 在 app/core
pnpm check
pnpm test
pnpm build
pnpm browser-test
git diff --check
```

如果修改了对应项目，还应运行其 lint：

```bash
pnpm --filter @manifold/web lint
pnpm --filter @manifold/admin lint
```

不要在没有新鲜命令输出的情况下声称测试、构建或文档同步完成。发现文档与代码不一致时，优先修正文档或代码，不要用模糊措辞掩盖差异。

## 提交规范

- 使用 Conventional Commits，例如 `feat(core): add content endpoint`、`docs: sync sdk contract`。
- 一个提交应保持单一逻辑主题；公共 API、实现、测试和必要文档可以在同一主题内一起提交。
- 不使用破坏性 git 命令覆盖用户未提交的工作。
