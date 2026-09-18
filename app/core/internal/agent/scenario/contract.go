package scenario

import (
	agentprompt "github.com/manifold-space/manifold/app/core/internal/agent/prompt"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type Scenario struct {
	Prompt agentprompt.Spec
	Tools  *agenttool.Registry
}

type Factory func() (Scenario, error)
