package scenarios_test

import (
	"context"
	"slices"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/scenarios"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type manifoldSource struct{}

func (manifoldSource) GetProfile(context.Context) (model.Profile, error) {
	return model.Profile{}, nil
}

func (manifoldSource) ListContent(context.Context, bool, store.ContentListOptions) (store.ContentListResult, error) {
	return store.ContentListResult{}, nil
}

type chainSource struct{}

func (chainSource) ChainInfo(context.Context) (chain.ChainInfoResult, error) {
	return chain.ChainInfoResult{}, nil
}

func TestManifoldFactoryRegistersPromptAndScenarioTools(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	if err := scenarios.RegisterManifold(registry, scenarios.ManifoldDependencies{Profile: manifoldSource{}, Content: manifoldSource{}}); err != nil {
		t.Fatal(err)
	}

	scenario, err := registry.Build(scenarios.Manifold)
	if err != nil {
		t.Fatal(err)
	}
	if scenario.SystemPrompt == "" {
		t.Fatal("Manifold scenario must provide its system prompt")
	}
	names := toolNames(scenario)
	want := []string{"calculator", "get_current_time", "get_thoughts", "get_user_profile", "get_writings"}
	if !slices.Equal(names, want) {
		t.Fatalf("unexpected Manifold tools: %v", names)
	}
}

func TestManifoldFactoryAddsChainToolOnlyWhenAvailable(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	if err := scenarios.RegisterManifold(registry, scenarios.ManifoldDependencies{Profile: manifoldSource{}, Content: manifoldSource{}, Chain: chainSource{}}); err != nil {
		t.Fatal(err)
	}

	scenario, err := registry.Build(scenarios.Manifold)
	if err != nil {
		t.Fatal(err)
	}
	if names := toolNames(scenario); !slices.Contains(names, "get_chain_status") {
		t.Fatalf("chain-enabled Manifold scenario is missing get_chain_status: %v", names)
	}
}

func toolNames(scenario agent.Scenario) []string {
	definitions := scenario.Tools.Definitions()
	names := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		names = append(names, definition.Name)
	}
	return names
}
