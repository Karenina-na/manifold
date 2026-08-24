# Web Contract

首页由四个稳定区块组成：

- Hero：个人单句定位、兴趣标签、头像、网站链接。
- Compact CV：教育/经历摘要和可选 PDF 简历下载。
- Recent Activity：按时间倒序混排最近 2 条 Article 与 3 条 Thought。
- Stats：已发布总量、字数、Writings、Thoughts。

`/thoughts` 使用轻量时间线，`/writing` 使用经典长文列表并显示阅读分钟数。详情页复用同一 Markdown 渲染核心；Article 有 TOC 侧栏，代码块使用 `rehype-highlight` 高亮并通过原生 Clipboard API 复制，数学公式使用 `remark-math` + `rehype-katex`，Thought 使用更轻的正文节奏。评论组件在两类内容中复用，包含可选联系方式和轻量验证码。Markdown 仍先经过 `rehype-sanitize`，第三方插件生成的结构在清洗后再渲染。
