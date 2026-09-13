# `app/web`

Manifold 公开阅读端，负责 Home、Thoughts、Writings、Markdown 阅读、评论和访客反应。

当前详细契约见 [`docs/decisions/web.md`](../../docs/decisions/web.md)，摘要索引见 [`docs/web.md`](../../docs/web.md)。其中记录 Next.js App Router 的页面、Server/Client Component 边界、SEO 数据流、Core 请求、评论/反应 query、Markdown 公式/高亮/sanitize/TOC/复制能力，以及 Design System 约束。

当前路由：`/`、`/thoughts`、`/thoughts/[slug]`、`/writing`、`/writing/[slug]`、`/feed.xml`、`/health`。

`/thoughts` 由 Server Component 读取 Core 的 Thoughts aggregate，翻页时请求 Core 的对应页；置顶有效性、最新回退、置顶排除、正文摘录和页数均由 Core 负责，Web 只把当前页按 UTC 年份/月份/日期组织成分块时间轴：年份为卡片 surface 之外的分节标题行，月份标签与日期节点在左栏和纵轴上，内容 surface 按年份框住卡片。Thoughts 与 Writings 归档都把星号灰色摘要和正文摘录分开，普通项限制两行正文、置顶项限制四行；归档页显示 Core 返回的点赞、观看和可见评论数，不在 Web 端额外请求评论或计算统计。

首页按 Profile/Introduction、Background、Recent Content、Updates、My Series、Contact 六段组织共同信息，区块顺序由站点设置的 `sections` 驱动；Recent Content 通过公共内容列表展示 Writings/Thoughts 双列与 Top tags，Updates 使用 Core `homeTimeline()` 返回的轻量、有限且按首发时间排序的最新内容构建可缩放轨道；My Series 使用紧凑索引卡片，Contact 使用纯图标 rail，详情在 hover/focus 时通过脱离局部层叠上下文的浮层展示；全局模拟终端在首次打开时挂载公开内容与站点链接，形成可通过 macOS 风格命令浏览的只读文件树；页脚在线人数通过 Core presence 心跳返回，不使用 mock；页面数据、状态徽标和内容链接仍以 Core 返回值为准。

源码按模块与职责分层：`app/` 只保存 App Router 路由、布局和路由样式；`components/layout/` 保存全局壳与 Provider，`components/ui/` 保存跨域小组件；`features/` 下的 archive、chain、comments、content、home 分别聚合各业务域的组件、状态、纯函数和同目录测试；`i18n/` 保存 locale 与翻译资源；`lib/` 只保存 Core client、观测、安全和主题等跨域基础设施。业务数据和规则仍由 Core 与共享契约定义。

安全边界同样按层放置：`proxy.ts` 是唯一的响应头与 CSP 出口（每请求 nonce），`lib/security.ts` 保存内联脚本序列化、CSP 脚本哈希和 cookie `Secure` 判定，两者都不参与业务逻辑。契约见 [`docs/decisions/web.md`](../../docs/decisions/web.md) 第 6 节。

## 运行

```bash
pnpm --filter @manifold/web dev
pnpm --filter @manifold/web typecheck
pnpm --filter @manifold/web lint
pnpm --filter @manifold/web test
pnpm --filter @manifold/web build
pnpm browser-test
```

根目录 `pnpm dev` 使用开发 supervisor 同时启动 Web 和 Admin；任一前端异常退出（包括 `SIGTERM` 导致的退出码 143）会按退避自动重启。直接运行本工作区命令时仍由调用方负责进程重启。

配置 `NEXT_PUBLIC_CORE_URL` 指向 Core，`NEXT_PUBLIC_SITE_URL` 用于 canonical 和 metadataBase。构建目录默认 `.next`；设置 `NEXT_DIST_DIR` 可把 dev/build 产物隔离到其他目录——`pnpm browser-test` 用它起独立的 Next 实例，避免与开发者自己运行的 `pnpm dev` 争夺 `.next` 锁。修改 Web 路由、页面数据、渲染器或交互时，必须同时检查 [`docs/decisions/web.md`](../../docs/decisions/web.md)、[`docs/core.md`](../../docs/core.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。

生产构建启用 Next.js standalone，并以仓库根目录作为 monorepo 文件追踪边界。根发布脚本负责把 standalone 默认不复制的 `public` 与 `.next/static` 补入产物，并只保留 Linux x64 glibc 原生依赖。`NEXT_PUBLIC_*` 在构建时固化，因此 `.env.production` 必须在打包前写入最终公开地址；目标服务器通过包内 `./manifold start` 启动 `server.js`，无需安装 workspace 依赖。
