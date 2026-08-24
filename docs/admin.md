# Admin Contract

Content 工作区是双模式编辑器：

- Thought：极简 Micro-post 输入，正文优先，标题、slug、来源和上下文可选。
- Writing：长文编辑面板，支持 Markdown、阅读时长、技术标签、语言、难度和 frontmatter JSON；预览复用 GFM、数学公式和代码高亮插件，避免编辑器与公开阅读器的解析差异。
- 已发布内容只能编辑公共字段和 metadata，更新必须提交 `expectedVersion`。
- 列表支持 `THOUGHT` / `ARTICLE` 类型筛选、草稿发布、撤回和软删除。

Dashboard 统计只消费 Core 返回的 `articleCount`、`thoughtCount`、总字数和待审核评论数，不在浏览器重新计算。
