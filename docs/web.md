# Web 契约索引

Web 的当前详细架构和 API 消费说明位于 [`docs/decisions/web.md`](decisions/web.md)。首页当前包含 Profile/Introduction、左右双栏 Writings/Thoughts 时间线、最近 10 个内容更新的等距月份 Updates 轨道、可按年份切换的 GitHub 风格 Contribution activity、My Series 索引卡片与纯图标 Contact rail；Series/Contact 详情使用挂载到 `document.body` 的最高层级 tooltip，内容仍由 Core 驱动。文章详情在标题阅读面上方单独显示返回 Writing 的入口，正文区域使用四段同宽的不透明阅读面、同排元数据、右侧标题进度目录；底部讨论面提供统计、搜索和筛选，添加评论面承载互动与表单，桌面/平板由左侧紧凑动作卡通过共享布局动画移入，越过激活线后继续下滑保持底部状态，仅向上越回激活线才恢复左侧，布局变化时自动重算，手机端在讨论面之后堆叠。共同信息的展示参考根目录 `1.html`。全局导航提供 route-aware pills、⌘K/Ctrl+K 搜索、主题切换、RSS 与 GitHub 外链。

本文只保留入口，避免 `docs/web.md` 与决策目录中的 Web 契约出现两份不一致的事实。修改 Web 路由、Core 请求、Markdown 渲染、评论/反应、SEO 或设计约束时，必须同步 `docs/decisions/web.md`，并检查本索引是否仍准确。
