# Manifold Architecture

Core 是系统记录源，负责 HTTP、校验、鉴权和 SQLite 持久化。Contracts 定义 HTTP 边界，SDK 负责 TypeScript 端传输；Web 与 Admin 不直接构造 endpoint-specific fetch 请求。

Browser -> Web/Admin -> @manifold/sdk -> Core HTTP API -> SQLite

Web 和 Admin 均由官方脚手架创建，业务页面在脚手架默认结构上演进。`sqlc.yaml` 与 `tygo.yaml` 预留生成式数据库代码和跨端契约出口。
