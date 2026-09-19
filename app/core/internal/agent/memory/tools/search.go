package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type Search struct{ Store agentmemory.Store }

func (Search) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{
		Name:        "search_memory",
		Description: "Search memory items bound to the current authenticated session by content. An empty query returns all items in the session.",
		Usage:       "Use before answering when a prior decision, stable preference, recurring fact, or other remembered item may be relevant, even if the conversation summary contains an approximate answer; use an empty query when the relevant memory topic is unclear.",
		Effect:      agenttool.ToolEffectReadOnly,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","maxLength":500,"description":"Case-insensitive content query; empty lists all session memories"}},"required":["query"],"additionalProperties":false}`),
	}
}

func (tool Search) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	if tool.Store == nil {
		return nil, errors.New("memory store is required")
	}
	var input struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode memory search arguments: %w", err)
	}
	query := strings.TrimSpace(input.Query)
	if len(query) > 500 {
		return nil, errors.New("memory query must not exceed 500 characters")
	}
	sessionID, err := agentmemory.SessionID(ctx)
	if err != nil {
		return nil, err
	}
	items, err := tool.Store.Search(ctx, sessionID, query)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}
