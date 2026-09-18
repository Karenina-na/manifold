package tools

import (
	"context"
	"encoding/json"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

type ProfileReader interface {
	GetProfile(ctx context.Context) (model.Profile, error)
}

type UserProfile struct{ Store ProfileReader }

func (UserProfile) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{Name: "get_user_profile", Description: "Get the author's current profile, background, interests and public links.", Usage: "Use for the author's profile, background, interests, preferences, or public links; do not infer profile facts that are not returned.", Effect: agenttool.ToolEffectReadOnly, Parameters: json.RawMessage(`{"type":"object","properties":{},"required":[],"additionalProperties":false}`)}
}

func (tool UserProfile) Execute(ctx context.Context, _ json.RawMessage) (any, error) {
	return tool.Store.GetProfile(ctx)
}
