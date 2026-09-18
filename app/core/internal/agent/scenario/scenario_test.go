package scenario_test

import (
	"errors"
	"testing"

	agentprompt "github.com/manifold-space/manifold/app/core/internal/agent/prompt"
	agentscenario "github.com/manifold-space/manifold/app/core/internal/agent/scenario"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

func TestRegistryBuildsRegisteredScenarios(t *testing.T) {
	registry := agentscenario.NewRegistry()
	want := agentscenario.Scenario{Prompt: agentprompt.Spec{Intro: "prompt"}, Tools: agenttool.NewRegistry()}
	if err := registry.Register("manifold", func() (agentscenario.Scenario, error) { return want, nil }); err != nil {
		t.Fatal(err)
	}

	got, err := registry.Build("manifold")
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt.Intro != want.Prompt.Intro || got.Tools != want.Tools {
		t.Fatalf("unexpected scenario: %+v", got)
	}
}

func TestRegistryRejectsDuplicateAndUnknownScenarios(t *testing.T) {
	registry := agentscenario.NewRegistry()
	factory := func() (agentscenario.Scenario, error) { return agentscenario.Scenario{}, nil }
	if err := registry.Register("manifold", factory); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register("manifold", factory); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
	if _, err := registry.Build("missing"); !errors.Is(err, agentscenario.ErrNotRegistered) {
		t.Fatalf("expected ErrNotRegistered, got %v", err)
	}
}
