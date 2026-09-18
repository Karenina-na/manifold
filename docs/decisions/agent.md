# Agent 运行时架构

## 状态

Accepted，2026-09-18。

## 背景

Admin 需要一个能读取作者画像、公开内容摘要与锚定链状态的私有助手，同时保持 Core 对数据、权限与工具行为的最终权威。运行时需要 SSE 反馈、工具调用展示、可替换的模型 Provider，以及同一认证 session 内可跨对话复用但不写入数据库的记忆。

## 决策

Agent 位于 `app/core/internal/agent`，由 `runtime`、`provider`、`conversation`、`memory`、`prompt`、`scenario` 与 `tool` 七个模块构成。Conversation 表示当前对话历史，Memory 表示同一 session 内可跨对话复用的记忆，Context 表示 Runtime 为一次 Provider 调用构造的输入。Runtime 是顶层运行编排者，可以依赖其他模块；其他模块不依赖 Runtime。Core 的 handler 负责创建 Provider Registry、Scenario、Conversation History 与 Memory Store，再把完成组装的依赖交给 Runtime。

Core 内部类型隔离上游协议：`provider.Provider` 只实现 `Chat(context.Context, ChatRequest) (*ChatResponse, error)`，模型协议与 Provider Registry 属于 `provider`，OpenAI Responses 适配位于 `provider/openai`；`runtime` 执行有限回合的 `LLM → tool → result → LLM` 循环并拥有 Context Builder、trace 与 SSE 运行事件；Context Builder 统一组装 system prompt、conversation history 与本次输入。

`tool` 模块按职责拆分 `Tool`、`ToolDefinition`、`ToolCall`、`ToolResult`、`Registry` 与 `Executor`。Registry 是能力真相源，只负责注册、定义校验和定义快照；Executor 从 Registry 解析调用、执行 Effect 门禁，并发执行同一轮全部调用，并按输入顺序返回每个调用独立的结果或错误。工具实现必须允许 Executor 并发调用。Executor 允许 `read_only` 与只修改当前 session 临时状态的 `session_write`，普通 `write` 和 `destructive` 工具在授权机制落地前默认拒绝。

场景是行为型 Prompt 与 Runtime 能力集合的唯一业务定制边界。`scenario.Registry` 注册按需构建场景的工厂，每个 `internal/agent/scenario/<scenario>` 目录同时拥有 Prompt、依赖接口和具体工具注册；当前 `scenario/manifold` 按 Store/Ledger/Memory 能力组装画像、内容、时间、计算器、只读链和记忆工具。场景业务工具位于其 `tools` 子包，通用记忆工具位于 `internal/agent/memory/tools`。`prompt.Spec` 只包含行为文本，不包含工具名称或描述；`prompt.Build` 依 Identity → Control/Safety → Evidence/Capability → Response Behavior 生成 `TOOL USE`、`MEMORY USE`、注册表投影的 `AVAILABLE TOOLS` 与 `CAPABILITY BOUNDARIES`。`AVAILABLE TOOLS` 包含工具名称、Effect、Provider `Description` 与 Prompt `Usage`，`CAPABILITY BOUNDARIES` 只保留注册工具、Effect 和运行时授权的通用边界，`Parameters` 仅用于 Provider schema。Runtime 只消费构建完成的 `scenario.Scenario`，不识别场景名称或具体工具；`Runtime.BuildContext` 为脚本和其他调试方式提供同一组装路径。新增只读场景无需修改 Provider、运行循环或 HTTP/SSE 契约；新增普通写入或破坏性场景必须同时提供运行时授权边界。

OpenAI 实现使用 Responses API，`store=false`、`parallel_tool_calls=true`。Runtime 把同一响应中的 function calls 一次性交给 Executor 并行执行，再把有序 `function_call_output` 转成内部 Message；reasoning output item 原样作为 Provider 私有上下文带入下一工具回合，同时提取 provider 提供的 summary 文本进入 trace 与 `reasoning.completed.message`，原始隐藏 reasoning 不进入 SSE 或共享 contracts。首版 Provider 调用本身是完整响应，Core SSE 用于统一传输运行阶段、工具结果、思考摘要和内容；以后 Provider 支持 token stream 时不需要改变 Admin 的事件联合。Context Builder 重建历史时不回放隐藏 reasoning，只将 assistant trace 中按回合分组的 tool call 与 tool result 恢复为 Provider 消息，保持 `assistant(tool_call) → tool(result) → assistant` 的边界。

当前对话能力归属 `conversation`：`History` 定义对话消息边界，`VolatileHistory` 提供按 Admin JWT `jti` 分区的进程内实现；不为尚未使用的 conversation 元数据建立实体。对话消息使用 `conversation.Message` 命名，以区别于 `provider.Message`。配置运行服务统一串行化同一 session 的 Run、List、Clear 与 Undo；Undo 原子截断目标用户消息及其后的整个对话尾部，并返回原文作为新草稿。注销、会话吊销或显式清空不会与正在生成的同 session 回复交错，Core 重启后全部 conversation history 丢失。

同一 session 内跨 conversation 的记忆能力归属独立 `memory` 模块。`Store` contract 显式接收 session ID，`InMemory` 提供并发安全的进程内 Search/Add/Update/Delete/Clear；`Item` 记录 ID、内容与创建/更新时间。Runtime 在执行工具前把受信的 JWT `jti` 绑定到 context，`search_memory` 和 `manage_memory` 不接收模型传入的 session ID。清空对话保留记忆；session 注销或被吊销时一并清理记忆；Core 重启后记忆丢失。System prompt 的独立 `MEMORY USE` section 约束只记录用户明确要求、项目决策、长期稳定偏好和明显可复用信息，排除临时情绪、一次性请求、大量工具原始数据、普通聊天细节和模型猜测。

Provider、模型、工具回合数、历史上限、输出上限、OpenAI Base URL 与 API key 由 Admin 设置页管理，持久化在 SQLite 的 `agent_settings` 单例，不属于进程环境配置。Base URL 在保存和 Provider 初始化时清理首尾空白、去掉尾部斜杠，并在路径中缺少 `v1` 时补齐 `/v1`。每次运行前读取当前设置并按值复用或重建 Runtime，因此保存后下一次运行立即生效。读取 API 只返回 `apiKeyConfigured`，API key 只支持替换或清除，不回传明文。设置更新产生 `agent.settings.updated` 审计事件；这类运行配置不描述公开内容或业务状态，按 `docs/chain.md` §4.2 不锚定。

Admin 使用顶部栏打开居中的全页模态对话框，不新增工作区路由。模态层从顶部滑入并配合背景虚化，正文按对话轮次归并 user/assistant 消息、运行轨迹与用量；assistant 消息的运行摘要随 conversation history 保存，重新打开后仍可展开思考卡片。所有消息气泡提供 Copy，仅 user 气泡提供 Undo；Undo 后原用户消息回到输入框，Core 返回的截断历史成为后续 Context。工具输入输出使用可折叠详情，思考摘要展示在对应思考步骤中，原始隐藏推理文本不展示。`/compact` 作为 transcript 时间线中的特殊 Agent turn 显示运行中、完成、无可压缩内容或失败结果，插入触发压缩的 turn 后并以水平分隔线与后续对话分开；它可展开 Summary 历史上下文与压缩统计，不写入 conversation history。共享 contracts 定义 SSE 判别联合，SDK 负责跨任意网络分片解析帧。

## 结果

- 新 Provider 只需实现内部接口并注册，不改变 HTTP 或 Admin 组件。
- 新场景通过独立目录同时注册 Prompt 和工具集合，不需要在 Handler 或 Runtime 中增加业务分支。
- 七个 Agent 模块各自拥有明确边界；场景能力在 `scenario` 内组装，运行过程由 Runtime 编排，Core handler 只负责创建当前所需的顶层依赖。
- 同轮工具调用由 Executor 并行执行；逐调用错误不会阻止其他调用完成，回填顺序保持稳定。
- 工具由 Core 注入真实 Store/Ledger 读取能力；内容能力按行为统一为 `content_list` 与 `content_get`，前者返回混合内容基本信息与摘要并支持类型过滤，后者按 slug 返回已发布正文；链工具只读，`get_content_anchor` 将 `content_get` 返回的内容 ID 与最新锚定证书关联，并用 `unanchored`、`pending`、`anchored` 区分无证书、待入块和已入块状态。
- Conversation history 与 memory 分离；memory 在同一 session 内跨对话保留，不跨 session、不跨进程，也不写入 SQLite。
- Agent 设置跨进程持久化；API key 的静态保护边界是 Core 数据库文件权限，HTTP、审计与日志均不包含其明文。
- 上游模型错误在流建立前映射为结构化 API 错误，在流建立后映射为 `run.error`，不把上游响应正文暴露给浏览器。
