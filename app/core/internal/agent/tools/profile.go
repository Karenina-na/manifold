package tools

import (
	"context"
	"encoding/json"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

type ProfileReader interface {
	GetProfile(ctx context.Context) (model.Profile, error)
}

type UserProfile struct{ Store ProfileReader }

func (UserProfile) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "get_user_profile", Description: "Get the author's current profile, background, interests and public links.", Usage: "Use for the author's profile, background, interests, preferences, or public links; do not infer profile facts that are not returned.", Parameters: json.RawMessage(`{"type":"object","properties":{},"required":[],"additionalProperties":false}`)}
}

func (tool UserProfile) Execute(ctx context.Context, _ json.RawMessage) (any, error) {
	return tool.Store.GetProfile(ctx)
}
