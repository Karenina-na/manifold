package tool_test

import (
	"context"
	"encoding/json"
	"testing"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type testTool struct {
	definition agenttool.ToolDefinition
	execute    func(context.Context, json.RawMessage) (any, error)
}

func (tool testTool) Definition() agenttool.ToolDefinition { return tool.definition }

func (tool testTool) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	if tool.execute == nil {
		return nil, nil
	}
	return tool.execute(ctx, arguments)
}

func TestRegistryValidatesAndSortsDefinitions(t *testing.T) {
	registry := agenttool.NewRegistry()
	for _, registered := range []testTool{
		{definition: definition("z_tool", agenttool.ToolEffectReadOnly)},
		{definition: definition("a_tool", agenttool.ToolEffectReadOnly)},
	} {
		if err := registry.Register(registered); err != nil {
			t.Fatal(err)
		}
	}

	definitions := registry.Definitions()
	if len(definitions) != 2 || definitions[0].Name != "a_tool" || definitions[1].Name != "z_tool" {
		t.Fatalf("unexpected definitions: %+v", definitions)
	}
	if err := registry.Register(testTool{definition: definition("a_tool", agenttool.ToolEffectReadOnly)}); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
}

func TestRegistryZeroValueCanRegister(t *testing.T) {
	var registry agenttool.Registry
	if err := registry.Register(testTool{definition: definition("test_tool", agenttool.ToolEffectReadOnly)}); err != nil {
		t.Fatal(err)
	}
	if definitions := registry.Definitions(); len(definitions) != 1 || definitions[0].Name != "test_tool" {
		t.Fatalf("unexpected definitions: %+v", definitions)
	}
}

func TestRegistryRequiresCompleteDefinitionMetadata(t *testing.T) {
	tests := []agenttool.ToolDefinition{
		{Name: "missing_description", Usage: "Use it.", Effect: agenttool.ToolEffectReadOnly},
		{Name: "missing_usage", Description: "Description.", Effect: agenttool.ToolEffectReadOnly},
		{Name: "missing_effect", Description: "Description.", Usage: "Use it."},
		{Name: "invalid_effect", Description: "Description.", Usage: "Use it.", Effect: "unknown"},
		{Name: "missing_parameters", Description: "Description.", Usage: "Use it.", Effect: agenttool.ToolEffectReadOnly},
		{Name: "invalid_parameters", Description: "Description.", Usage: "Use it.", Effect: agenttool.ToolEffectReadOnly, Parameters: json.RawMessage(`{"type":`)},
	}
	for _, definition := range tests {
		registry := agenttool.NewRegistry()
		if err := registry.Register(testTool{definition: definition}); err == nil {
			t.Fatalf("expected invalid definition to fail: %+v", definition)
		}
	}
}

func definition(name string, effect agenttool.ToolEffect) agenttool.ToolDefinition {
	return agenttool.ToolDefinition{
		Name:        name,
		Description: "Test tool.",
		Usage:       "Use the test tool.",
		Effect:      effect,
		Parameters:  json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
	}
}
