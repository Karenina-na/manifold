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

type Manage struct{ Store agentmemory.Store }

func (Manage) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{
		Name:        "manage_memory",
		Description: "Add, update, or delete one memory item bound to the current authenticated session.",
		Usage:       "Use to add stable reusable information, update an existing item by ID when it changes, or delete an item by ID when the user asks to forget it or it is no longer valid. Search when a related item may already exist.",
		Effect:      agenttool.ToolEffectSessionWrite,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"action":{"type":"string","enum":["add","update","delete"]},"id":{"type":"string","description":"Existing memory item ID; required for update and delete"},"content":{"type":"string","description":"Memory content; required for add and update"}},"required":["action"],"additionalProperties":false}`),
	}
}

func (tool Manage) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	if tool.Store == nil {
		return nil, errors.New("memory store is required")
	}
	var input struct {
		Action  string `json:"action"`
		ID      string `json:"id"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode memory management arguments: %w", err)
	}
	sessionID, err := agentmemory.SessionID(ctx)
	if err != nil {
		return nil, err
	}
	input.Action = strings.TrimSpace(input.Action)
	input.ID = strings.TrimSpace(input.ID)
	input.Content = strings.TrimSpace(input.Content)
	switch input.Action {
	case "add":
		if input.ID != "" || input.Content == "" {
			return nil, errors.New("add requires content and does not accept id")
		}
		item, err := tool.Store.Add(ctx, sessionID, input.Content)
		if err != nil {
			return nil, err
		}
		return map[string]any{"item": item}, nil
	case "update":
		if input.ID == "" || input.Content == "" {
			return nil, errors.New("update requires id and content")
		}
		item, err := tool.Store.Update(ctx, sessionID, input.ID, input.Content)
		if err != nil {
			return nil, err
		}
		return map[string]any{"item": item}, nil
	case "delete":
		if input.ID == "" || input.Content != "" {
			return nil, errors.New("delete requires id and does not accept content")
		}
		if err := tool.Store.Delete(ctx, sessionID, input.ID); err != nil {
			return nil, err
		}
		return map[string]string{"deletedId": input.ID}, nil
	default:
		return nil, errors.New("action must be add, update, or delete")
	}
}
