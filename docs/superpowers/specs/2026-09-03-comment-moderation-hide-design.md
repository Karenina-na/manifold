# Comment Moderation: Hide + Edit-Author

Status: Draft
Date: 2026-09-03

## 问题

Admin 端目前对评论只有「删除 / 恢复」两种控制。需要新增：

1. **隐藏（hide）**：一种独立于软删除的软状态。隐藏后的评论在公开端不泄露作者/正文，而是渲染占位符；同时不再计入 `comment_count`。删除则维持现状——直接从公开响应剔除、不渲染占位符。
2. **修改评论者基本信息（authorName / authorUrl / avatarSeed）**：管理员可覆盖评论人自助填写的资料，公开端直接展示覆盖后的值。

## 目标与边界

- 隐藏是**软状态**，可恢复；删除仍是软删除并从公开响应剔除，两者正交。
- 隐藏**只作用于被选中的那一行**，不做级联（不隐藏其回复）。
- 作者资料修改**直接覆盖**，不保留修改历史、不支持切换。
- 被隐藏的评论**渲染占位符**，而非彻底剔除；占位符不展示作者/正文/关键词匹配。
- 隐藏**不计入** `comment_count`（导致卡片/统计/总览里的计数下降，等同删除；恢复则回升）。

## 1. 数据库（0002 增量迁移）

新增 `app/core/db/migrations/0002_comment_hidden.sql`：

```sql
ALTER TABLE comments ADD COLUMN hidden_at TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_hidden ON comments(content_id, created_at) WHERE hidden_at IS NULL;
```

- `hidden_at` 与 `deleted_at` 并存，都是可空时间戳软状态。一行可同时处于：正常 / 已隐藏 / 已删除 / 两者兼有。
- `schemaVersion` 从 `1` 升到 `2`（`store.go:23`）。

### 必需：放宽迁移门禁（本次改动的一部分）

`store.go:migrate()` 当前的守卫：

```go
if existingTables > 0 && userVersion != schemaVersion {
	return ErrSchemaMismatch // "delete the local database and recreate it"
}
```

它会把任何 `userVersion != schemaVersion` 的已有库都当成不匹配而拒绝，导致「增量升级已有库」无法发生。改为仅当库**比 binary 新**时拒绝：

```go
if existingTables > 0 && userVersion > schemaVersion {
	return ErrSchemaMismatch // binary too old for this database
}
```

早期库（`userVersion < schemaVersion`）放行，交由下方已有的 `current+1..schemaVersion` 循环做增量升级。`schema_migrations` 与 `PRAGMA user_version` 原本就同步写入，二者不会漂移。

## 2. 契约（`packages/contracts/src/index.ts`）

- `Comment`（公开）新增 `hidden: boolean` —— web 端读取此标志渲染占位符。
- `AdminComment` 新增 `hiddenAt: string | null`（管理端可见何时被隐藏；`deletedAt` 已存在）。
- 新增 `UpdateCommentInput { authorName?: string; authorUrl?: string | null; avatarSeed?: string }`。
- 更新 `test/fixtures/wire.json` 与 `contracts/README.md`，保持 Go golden 测试与 TS fixtures 测试同时通过。

## 3. Core

### Store（`internal/store/comment_store.go`）

- `commentColumns` 及 `scanComment` / `scanAdminComments` 增加 `hidden_at`。
- `CreateComment` 不变（新评论默认可见）。
- `HideComment(id)` / `UnhideComment(id)`：在与 `deleted_at IS NULL` 的非删除行上设置/清空 `hidden_at`，返回 `content_id`，并刷新计数。
- `UpdateCommentAuthor(id, authorName?, authorUrl?, avatarSeed?)`：就地覆盖三个字段。`authorUrl` 需区分「未提供」与「显式置空」。
- `refreshCommentCountTx` 的计数增加 `AND hidden_at IS NULL`。隐藏使 `comment_count` 下降、恢复回升；该计数同时驱动卡片、AdminOverview 的 `totalComments`。

### Handler（`comment_handler.go` + `admin_handler.go`）与路由（`response.go`）

- 公开 `ListComments`：仍返回所有未删除评论（含隐藏项，标记 `hidden: true`），使占位符与其顶层线程同页分页；`pagination.totalItems` 仍统计未删除评论。
- 新增管理端点：
  - `POST /api/v1/admin/comments/{id}/hide`
  - `POST /api/v1/admin/comments/{id}/unhide`
  - `PUT /api/v1/admin/comments/{id}`（作者资料编辑）
- 审计事件：`comment.hidden` / `comment.unhidden` / `comment.updated`。沿用现有 `invalidateContentBySlug` / `contentCache.Remove` 缓存失效逻辑。

## 4. Admin UI

- `workspaces/CommentsWorkspace.tsx`：行操作从「删除/恢复」扩展为「隐藏/取消隐藏 + 删除/恢复」；隐藏行显示「hidden」标签。
- `components/ContentCommentsPanel.tsx`：同样扩展行操作（`CommentNode` / `CommentReply`）；新增「编辑作者」入口（内联或小弹窗）提交三个字段。

## 5. Web UI（`comment-thread.tsx`）

- `CommentItem`：当 `comment.hidden` 时，渲染一条静音占位符（不展示作者/头像/正文/URL/关键词）、保留节点，使其回复仍嵌套其下（遵循「只隐藏选中行」）。
- `filterComments`：对隐藏评论不匹配作者/正文（占位符不参与搜索）。
- 线程「N comments」徽标继续读取 `pagination.totalItems`（占位符仍计入，以保证分页页数精确）；`comment_count` 层的「不计入」已按需求实现。

## 错误处理与测试

- 隐藏/恢复/编辑对不存在或已删除的评论返回 404 / 422；编辑作者的 `authorUrl` 校验沿用公开创建时的长度限制。
- 新增 store 层测试：隐藏→计数归零→恢复→计数回升；隐藏与删除正交（可同时为真）；作者资料覆盖后公开端读到新值；增量迁移 `0002` 在 `userVersion=1` 的旧库上正确升级。
- 更新 fixtures、SDK 方法（新增 `hideComment`/`unhideComment`/`updateCommentAuthor`）与对应测试。

## 开放项

- 占位文案默认 "This comment was hidden by moderation."（可再定夺）。
- 是否在同一 PR 显式更新 docs/core.md、docs/admin.md、docs/decisions/web.md —— 需同步，遵循项目约定的同步门槛。
