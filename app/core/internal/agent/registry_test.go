package agent_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
)

type effectTool struct {
	effect agent.ToolEffect
	called *bool
}

func (tool effectTool) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "effect_tool", Description: "Test tool", Usage: "Use the test tool.", Effect: tool.effect, Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}
}

func (tool effectTool) Execute(context.Context, json.RawMessage) (any, error) {
	*tool.called = true
	return "ok", nil
}

func TestToolRegistryRequiresADeclaredEffect(t *testing.T) {
	for _, effect := range []agent.ToolEffect{"", "unknown"} {
		registry := agent.NewToolRegistry()
		if err := registry.Register(effectTool{effect: effect, called: new(bool)}); err == nil {
			t.Fatalf("expected invalid tool effect %q to be rejected", effect)
		}
	}
}

func TestToolRegistryRequiresProviderAndPromptDescriptions(t *testing.T) {
	for _, test := range []struct {
		name        string
		description string
		usage       string
	}{
		{name: "missing provider description", usage: "Use the tool."},
		{name: "missing prompt usage", description: "Provider description."},
	} {
		registry := agent.NewToolRegistry()
		tool := effectTool{effect: agent.ToolEffectReadOnly, called: new(bool)}
		definition := tool.Definition()
		definition.Name = test.name
		definition.Description = test.description
		definition.Usage = test.usage
		custom := describedEffectTool{definition: definition, called: tool.called}
		if err := registry.Register(custom); err == nil {
			t.Fatalf("expected %s to be rejected", test.name)
		}
	}
}

type describedEffectTool struct {
	definition agent.ToolDefinition
	called     *bool
}

func (tool describedEffectTool) Definition() agent.ToolDefinition { return tool.definition }

func (tool describedEffectTool) Execute(context.Context, json.RawMessage) (any, error) {
	*tool.called = true
	return "ok", nil
}

func TestToolRegistryRejectsNonReadOnlyExecutionUntilAuthorized(t *testing.T) {
	called := false
	registry := agent.NewToolRegistry()
	if err := registry.Register(effectTool{effect: agent.ToolEffectWrite, called: &called}); err != nil {
		t.Fatal(err)
	}

	_, err := registry.Execute(t.Context(), agent.ToolCall{Name: "effect_tool"})
	if !errors.Is(err, agent.ErrToolEffectNotAllowed) {
		t.Fatalf("expected ErrToolEffectNotAllowed, got %v", err)
	}
	if called {
		t.Fatal("non-read-only tool executed without authorization")
	}
}
