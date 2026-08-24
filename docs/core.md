# Core Contract

当前 Core 以一张 `content` 表承载两类内容：`THOUGHT` 和 `ARTICLE`。

- `THOUGHT`：正文优先，`title` 与 `slug` 可为空；公开链接使用内容 ID。
- `ARTICLE`：`title`、`slug` 必填；用于深度技术文章、实验复盘和架构方案。
- 两者都使用 Markdown 正文、标签、评论、访客反应和发布生命周期。
- `metadata_json` 保存类型扩展：Thought 的 `mood/question/context/source`，Article 的 `readingMinutes/toc/frontmatter`。

兼容迁移会把历史 `POST/NOTE/RESEARCH` 与 `TECH/MANUSCRIPT` 映射到 `ARTICLE/THOUGHT`，并重建 SQLite CHECK 约束。相关测试覆盖类型映射、metadata 持久化和迁移后新建内容。

接口使用 `GET /api/v1/content?kind=THOUGHT|ARTICLE` 分页检索；公开详情使用 `/api/v1/content/{slug-or-id}`。评论的 `authorName` 与 `authorUrl` 均为可选持久化字段。
