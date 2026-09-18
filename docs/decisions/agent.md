# Agent 运行时架构

## 状态

Accepted，2026-09-17。

## 背景

Admin 需要一个能读取作者画像、公开内容摘要与锚定链状态的私有助手，同时保持 Core 对数据、权限与工具行为的最终权威。首版还需要 SSE 反馈、工具调用展示和可替换的模型 Provider，但不需要持久化长期记忆。

## 决策

Agent 运行时位于 `app/core/internal/agent`。Core 内部类型隔离上游协议：Provider 只实现 `Chat(context.Context, ChatRequest) (*ChatResponse, error)`，Registry 按名称解析 Provider、Scenario 和 Tool；Runtime 执行有限回合的 `LLM → tool → result → LLM` 循环；Context Builder 统一组装 system prompt、session 历史与本次输入。

场景是行为型 Prompt 与 Runtime 能力集合的唯一业务定制边界。`ScenarioRegistry` 注册按需构建场景的工厂，`internal/agent/scenarios` 保存具体场景；当前 `manifold` 工厂通过独立的 `ManifoldPrompt` 提供角色、指令范围、证据优先级和安全规则，并按 Store/Ledger 能力组装画像、内容、时间、计算器与只读链工具。`ToolRegistry` 是当前能力真相源，工具注册必须同时声明 Provider `Description`、Prompt `Usage` 和 `Effect`；`Effect` 声明工具是只读、写入还是破坏性操作。`PromptSpec.Build` 只把注册表中的名称、`Usage` 和 `Effect` 投影到 `TOOL USE`/`CAPABILITY BOUNDARIES`，不会由场景 Prompt 自己声称权限，`Effect` 同时作为 Runtime 执行保护。工具的 Provider schema 描述仍由 `Description` 与 `Parameters` 负责，两者保持边界。当前 Runtime 只执行 `read_only` 工具，其他效果在授权机制落地前默认拒绝。Runtime 只消费构建完成的 `Scenario`，不识别场景名称或具体工具。新增只读场景无需修改 Provider、运行循环、记忆或 HTTP/SSE 契约；新增写入场景必须同时提供运行时授权边界。

OpenAI 实现使用 Responses API，`store=false`、`parallel_tool_calls=false`。Runtime 自己执行 function tools，并把 `function_call` 与 `function_call_output` 转成内部 Message；reasoning output item 仅作为 Provider 私有上下文原样带入下一工具回合，不进入 SSE 或共享 contracts。首版 Provider 调用本身是完整响应，Core SSE 用于统一传输运行阶段、工具结果和内容；以后 Provider 支持 token stream 时不需要改变 Admin 的事件联合。

记忆能力直接归属 `internal/agent`：`SessionMessageRepository` 与 `SessionMemory` 定义 session 消息边界，`Memory` 提供按 Admin JWT `jti` 分区的进程内实现；不为尚未使用的会话元数据建立实体。持久消息使用 `SessionMessage` 命名，以区别于 Provider 对话使用的 `Message`。配置运行服务统一串行化同一 session 的 Run、List、Clear 与 Undo；Undo 原子截断目标用户消息及其后的整个对话尾部，并返回原文作为新草稿。注销、会话吊销或显式清空不会与正在生成的同 session 回复交错，Core 重启后全部记忆丢失。

Provider、模型、工具回合数、历史上限、输出上限、OpenAI Base URL 与 API key 由 Admin 设置页管理，持久化在 SQLite 的 `agent_settings` 单例，不属于进程环境配置。Base URL 在保存和 Provider 初始化时清理首尾空白、去掉尾部斜杠，并在路径中缺少 `v1` 时补齐 `/v1`。每次运行前读取当前设置并按值复用或重建 Runtime，因此保存后下一次运行立即生效。读取 API 只返回 `apiKeyConfigured`，API key 只支持替换或清除，不回传明文。设置更新产生 `agent.settings.updated` 审计事件；这类运行配置不描述公开内容或业务状态，按 `docs/chain.md` §4.2 不锚定。

Admin 使用顶部栏打开居中的全页模态对话框，不新增工作区路由。模态层从顶部滑入并配合背景虚化，正文按对话轮次归并 user/assistant 消息、运行轨迹与用量；assistant 消息的运行摘要随 session memory 保存，重新打开后仍可展开思考卡片。所有消息气泡提供 Copy，仅 user 气泡提供 Undo；Undo 后原用户消息回到输入框，Core 返回的截断历史成为后续上下文。工具输入输出使用可折叠详情，推理只展示阶段状态，不展示模型隐藏推理文本。共享 contracts 定义 SSE 判别联合，SDK 负责跨任意网络分片解析帧。

## 结果

- 新 Provider 只需实现内部接口并注册，不改变 HTTP 或 Admin 组件。
- 新场景通过工厂同时注册 Prompt 和工具集合，不需要在 Handler 或 Runtime 中增加业务分支。
- 工具由 Core 注入真实 Store/Ledger 读取能力；内容列表工具返回摘要，`get_writing`/`get_thought` 按 slug 返回已发布正文，链工具只读；`get_content_anchor` 将内容 ID 与最新锚定证书关联，并用 `unanchored`、`pending`、`anchored` 区分无证书、待入块和已入块状态。
- 当前对话不具备跨 session、跨进程或长期记忆语义。
- Agent 设置跨进程持久化；API key 的静态保护边界是 Core 数据库文件权限，HTTP、审计与日志均不包含其明文。
- 上游模型错误在流建立前映射为结构化 API 错误，在流建立后映射为 `run.error`，不把上游响应正文暴露给浏览器。
