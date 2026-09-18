package agent

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

type Message struct {
	Role            Role
	Content         string
	ToolCalls       []agenttool.ToolCall
	ToolCallID      string
	ProviderContext []json.RawMessage
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
	ProviderContext []json.RawMessage
	Usage           Usage
	FinishReason    FinishReason
}

type EventType string

const (
	EventRunStarted         EventType = "run.started"
	EventReasoningStarted   EventType = "reasoning.started"
	EventReasoningCompleted EventType = "reasoning.completed"
	EventContentDelta       EventType = "content.delta"
	EventToolStarted        EventType = "tool.started"
	EventToolCompleted      EventType = "tool.completed"
	EventRunCompleted       EventType = "run.completed"
	EventRunError           EventType = "run.error"
)

type StreamEvent struct {
	Type         EventType    `json:"type"`
	RunID        string       `json:"runId,omitempty"`
	MessageID    string       `json:"messageId,omitempty"`
	Delta        string       `json:"delta,omitempty"`
	CallID       string       `json:"callId,omitempty"`
	Name         string       `json:"name,omitempty"`
	Input        any          `json:"input,omitempty"`
	Output       any          `json:"output,omitempty"`
	IsError      *bool        `json:"isError,omitempty"`
	FinishReason FinishReason `json:"finishReason,omitempty"`
	Usage        *Usage       `json:"usage,omitempty"`
	Code         string       `json:"code,omitempty"`
	Message      string       `json:"message,omitempty"`
}
