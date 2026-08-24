# Admin 历史决策索引

> 本文件只保留管理端架构决策背景，不是当前工作区或 API 清单。当前实现以 [`docs/admin.md`](../admin.md) 为准。

## 决策：Admin 与 Web 独立部署

状态：Accepted。

Admin 使用 Vite + React，Web 使用 Next.js。两者不共享页面组件或路由，只共享 `packages/contracts`、`packages/sdk` 和 Core API。这样可以让私有运营工作台采用更适合密集表单的组件体系，而公开 Web 保持 SSR/SEO 和阅读体验。

## 决策：服务端状态由 TanStack Query 管理

状态：Accepted。

Admin 不在浏览器复制 Core 的业务聚合；查询、mutation、资源级失效和错误都围绕 Core response 组织。每个工作区拥有明确 query key，写入成功后只失效受影响的资源。

## 决策：内容编辑器按 Thought/Article 分模式

状态：Accepted。

Thought 采用快速发布表单；Article 采用长文 Markdown 双栏预览。两者共享底层 contracts 和 Core content 表，但字段和 metadata 在表单层明确分流。Article 预览与 Web 阅读器共享 GFM、公式、代码高亮和 sanitize 能力。

## 变更规则

工作区、Core API 调用、表单字段、query key、认证或依赖变化必须更新 [`docs/admin.md`](../admin.md)，并检查 [`docs/core.md`](../core.md)、[`docs/decisions/web.md`](web.md)、SDK/Contracts 文档和根目录 [`AGENTS.md`](../../AGENTS.md)。
