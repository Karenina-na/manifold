package provider

import (
	"encoding/json"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

type ProviderContext []json.RawMessage

type Message struct {
	Role            Role
	Content         string
	ToolCalls       []agenttool.ToolCall
	ToolCallID      string
	ProviderContext ProviderContext
}

type ChatOptions struct {
	MaxOutputTokens int
}

type ChatRequest struct {
	Messages []Message
	Tools    []agenttool.ToolDefinition
	Model    string
	Options  ChatOptions
}

type Usage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
	TotalTokens  int `json:"totalTokens"`
}

type FinishReason string

const (
	FinishStop      FinishReason = "stop"
	FinishToolCalls FinishReason = "tool_calls"
	FinishMaxTokens FinishReason = "max_tokens"
	FinishError     FinishReason = "error"
)

type ChatResponse struct {
	Content         string
	ToolCalls       []agenttool.ToolCall
	ProviderContext ProviderContext
	Usage           Usage
	FinishReason    FinishReason
}
