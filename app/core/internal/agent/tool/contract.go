package tool

import (
	"context"
	"encoding/json"
)

// Tool implementations may be invoked concurrently by Executor.
type Tool interface {
	Definition() ToolDefinition
	Execute(ctx context.Context, arguments json.RawMessage) (any, error)
}

type ToolEffect string

const (
	ToolEffectReadOnly     ToolEffect = "read_only"
	ToolEffectSessionWrite ToolEffect = "session_write"
	ToolEffectWrite        ToolEffect = "write"
	ToolEffectDestructive  ToolEffect = "destructive"
)

func (effect ToolEffect) valid() bool {
	switch effect {
	case ToolEffectReadOnly, ToolEffectSessionWrite, ToolEffectWrite, ToolEffectDestructive:
		return true
	default:
		return false
	}
}

type ToolDefinition struct {
	Name        string
	Description string
	Usage       string
	Effect      ToolEffect
	Parameters  json.RawMessage
}

func cloneDefinition(definition ToolDefinition) ToolDefinition {
	definition.Parameters = append(json.RawMessage(nil), definition.Parameters...)
	return definition
}

type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

type ToolResult struct {
	CallID string
	Name   string
	Output any
	Err    error
}
