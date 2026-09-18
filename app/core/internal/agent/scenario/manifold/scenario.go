package manifold

import (
	"errors"

	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	memorytools "github.com/manifold-space/manifold/app/core/internal/agent/memory/tools"
	agentscenario "github.com/manifold-space/manifold/app/core/internal/agent/scenario"
	manifoldtools "github.com/manifold-space/manifold/app/core/internal/agent/scenario/manifold/tools"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

const Name = "manifold"

type Dependencies struct {
	Profile      manifoldtools.ProfileReader
	Content      manifoldtools.ContentReader
	Chain        manifoldtools.ChainReader
	ChainAnchors manifoldtools.ContentAnchorReader
	Memory       agentmemory.Store
}

func Register(registry *agentscenario.Registry, dependencies Dependencies) error {
	if registry == nil {
		return errors.New("scenario registry is required")
	}
	if dependencies.Profile == nil || dependencies.Content == nil || dependencies.Memory == nil {
		return errors.New("Manifold profile, content, and memory stores are required")
	}
	return registry.Register(Name, func() (agentscenario.Scenario, error) {
		tools := agenttool.NewRegistry()
		for _, registered := range []agenttool.Tool{
			manifoldtools.CurrentTime{},
			manifoldtools.Calculator{},
			manifoldtools.UserProfile{Store: dependencies.Profile},
			manifoldtools.ContentList{Store: dependencies.Content},
			manifoldtools.ContentGet{Store: dependencies.Content},
			memorytools.Search{Store: dependencies.Memory},
			memorytools.Manage{Store: dependencies.Memory},
		} {
			if err := tools.Register(registered); err != nil {
				return agentscenario.Scenario{}, err
			}
		}
		if dependencies.Chain != nil {
			if err := tools.Register(manifoldtools.ChainStatus{Ledger: dependencies.Chain}); err != nil {
				return agentscenario.Scenario{}, err
			}
		}
		if dependencies.ChainAnchors != nil {
			if err := tools.Register(manifoldtools.ContentAnchor{Ledger: dependencies.ChainAnchors}); err != nil {
				return agentscenario.Scenario{}, err
			}
		}
		return agentscenario.Scenario{Prompt: Prompt(), Tools: tools}, nil
	})
}
