# Core 历史决策索引

> 本文件只保留架构决策背景，不是当前 API 清单。当前 Core 的路由、数据模型、配置、错误和验证规则以 [`docs/core.md`](../core.md) 为唯一事实来源。

## 决策：Core 作为唯一业务数据所有者

状态：Accepted。

Core 使用 Go REST/JSON、SQLite、JWT + Casbin，并由 `Store` 集中管理持久化。Web/Admin 不直接读取数据库，跨端边界通过 `packages/contracts` 和 `packages/sdk` 维持。

原因：个人站点需要低运维、可本地启动、可测试的单一数据源；把业务规则放在 Core 可以避免多个客户端复制发布状态、统计和权限判断。

## 决策：统一 Content 表，按 kind 区分形态

状态：Accepted，当前枚举为 `THOUGHT` 和 `ARTICLE`。

早期设计曾使用 `TECH`、`NOTE`、`POST`、`RESEARCH`、`MANUSCRIPT` 等类型。SQLite 迁移将旧值映射到当前两种类型；历史类型不再作为公共 API 枚举。Thought 使用正文优先的轻量 metadata，Article 使用阅读时长、TOC、frontmatter、技术标签等深度文稿 metadata。

## 决策：显式生命周期和乐观并发

状态：Accepted。

内容状态为 `DRAFT`、`PUBLISHED`、`DELETED`。删除采用软删除；更新必须携带 `expectedVersion`，避免两个 Admin 标签页静默覆盖彼此的修改。评论独立使用 `PENDING`、`APPROVED`、`REJECTED`。

## 决策：非关键审计异步化

状态：Accepted。

审计事件通过有界队列写入 SQLite。队列满时不阻塞业务请求，关闭时由 `RouterWithLifecycle` 在有限时间内 drain。缓存只优化读取，不改变公共 response shape。

## 变更规则

涉及上述决策、Core API 或 schema 的改动必须先更新 [`docs/core.md`](../core.md)，再同步 [`docs/admin.md`](../admin.md)、[`docs/decisions/web.md`](web.md)、[`packages/contracts/README.md`](../../packages/contracts/README.md) 和 [`packages/sdk/README.md`](../../packages/sdk/README.md)。根目录 [`AGENTS.md`](../../AGENTS.md) 定义完整同步和验证门槛。
