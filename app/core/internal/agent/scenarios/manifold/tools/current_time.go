package tools

import (
	"context"
	"encoding/json"
	"time"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type CurrentTime struct{ Now func() time.Time }

func (CurrentTime) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{Name: "get_current_time", Description: "Get the current UTC date and time.", Usage: "Use when the answer depends on the current date or time; do not infer the current clock value.", Effect: agenttool.ToolEffectReadOnly, Parameters: json.RawMessage(`{"type":"object","properties":{},"required":[],"additionalProperties":false}`)}
}

func (tool CurrentTime) Execute(_ context.Context, _ json.RawMessage) (any, error) {
	now := tool.Now
	if now == nil {
		now = time.Now
	}
	value := now().UTC()
	return map[string]string{"date": value.Format(time.DateOnly), "dateTime": value.Format(time.RFC3339), "timezone": "UTC"}, nil
}
