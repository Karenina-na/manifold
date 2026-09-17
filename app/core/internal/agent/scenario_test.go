package agent_test

import (
	"errors"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
)

func TestScenarioRegistryBuildsRegisteredScenarios(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	want := agent.Scenario{Prompt: agent.PromptSpec{Intro: "prompt"}, Tools: agent.NewToolRegistry()}
	if err := registry.Register("manifold", func() (agent.Scenario, error) { return want, nil }); err != nil {
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

func TestScenarioRegistryRejectsDuplicateAndUnknownScenarios(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	factory := func() (agent.Scenario, error) { return agent.Scenario{}, nil }
	if err := registry.Register("manifold", factory); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register("manifold", factory); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
	if _, err := registry.Build("missing"); !errors.Is(err, agent.ErrNotRegistered) {
		t.Fatalf("expected ErrNotRegistered, got %v", err)
	}
}
