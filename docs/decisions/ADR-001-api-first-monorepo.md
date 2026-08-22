# ADR-001: API-First Monorepo

## Status
Accepted

## Date
2026-08-22

## Decision
使用 pnpm workspace 管理 TypeScript 消费端，使用独立 Go module 承载 Core。Core 负责 REST 与 SQLite；Contracts 保存跨端类型；SDK 是唯一客户端传输层。Web 和 Admin 由官方 create-next-app/create-vite 脚手架初始化。

## Consequences
Go 与 TypeScript 工具链都需要在 CI 中可用。sqlc 与 tygo 的生成步骤作为后续显式构建步骤接入。
