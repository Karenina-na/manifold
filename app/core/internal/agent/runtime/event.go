package runtime

import agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"

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
	Type         EventType                  `json:"type"`
	RunID        string                     `json:"runId,omitempty"`
	MessageID    string                     `json:"messageId,omitempty"`
	Delta        string                     `json:"delta,omitempty"`
	CallID       string                     `json:"callId,omitempty"`
	Name         string                     `json:"name,omitempty"`
	Input        any                        `json:"input,omitempty"`
	Output       any                        `json:"output,omitempty"`
	IsError      *bool                      `json:"isError,omitempty"`
	FinishReason agentprovider.FinishReason `json:"finishReason,omitempty"`
	Usage        *agentprovider.Usage       `json:"usage,omitempty"`
	Code         string                     `json:"code,omitempty"`
	Message      string                     `json:"message,omitempty"`
}
