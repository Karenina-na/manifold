package manifold

import (
	"errors"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	manifoldtools "github.com/manifold-space/manifold/app/core/internal/agent/scenarios/manifold/tools"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

const Name = "manifold"

type Dependencies struct {
	Profile      manifoldtools.ProfileReader
	Content      manifoldtools.ContentReader
	Chain        manifoldtools.ChainReader
	ChainAnchors manifoldtools.ContentAnchorReader
}

func Register(registry *agent.ScenarioRegistry, dependencies Dependencies) error {
	if registry == nil {
		return errors.New("scenario registry is required")
	}
	if dependencies.Profile == nil || dependencies.Content == nil {
		return errors.New("Manifold profile and content readers are required")
	}
	return registry.Register(Name, func() (agent.Scenario, error) {
		tools := agenttool.NewRegistry()
		for _, registered := range []agenttool.Tool{
			manifoldtools.CurrentTime{},
			manifoldtools.Calculator{},
			manifoldtools.UserProfile{Store: dependencies.Profile},
			manifoldtools.ContentList{Store: dependencies.Content},
			manifoldtools.ContentGet{Store: dependencies.Content},
		} {
			if err := tools.Register(registered); err != nil {
				return agent.Scenario{}, err
			}
		}
		if dependencies.Chain != nil {
			if err := tools.Register(manifoldtools.ChainStatus{Ledger: dependencies.Chain}); err != nil {
				return agent.Scenario{}, err
			}
		}
		if dependencies.ChainAnchors != nil {
			if err := tools.Register(manifoldtools.ContentAnchor{Ledger: dependencies.ChainAnchors}); err != nil {
				return agent.Scenario{}, err
			}
		}
		return agent.Scenario{Prompt: Prompt(), Tools: tools}, nil
	})
}
