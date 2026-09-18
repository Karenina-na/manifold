package tool_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

func TestExecutorRunsCallsInParallelAndPreservesCallOrder(t *testing.T) {
	registry := agenttool.NewRegistry()
	started := make(chan string, 2)
	release := make(chan struct{})
	for _, name := range []string{"first", "second"} {
		name := name
		if err := registry.Register(testTool{
			definition: definition(name, agenttool.ToolEffectReadOnly),
			execute: func(context.Context, json.RawMessage) (any, error) {
				started <- name
				<-release
				return name + " output", nil
			},
		}); err != nil {
			t.Fatal(err)
		}
	}

	done := make(chan []agenttool.ToolResult, 1)
	go func() {
		done <- agenttool.NewExecutor(registry).Execute(t.Context(), []agenttool.ToolCall{
			{ID: "call_1", Name: "first"},
			{ID: "call_2", Name: "second"},
		})
	}()

	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("tool calls did not start in parallel")
		}
	}
	close(release)
	results := <-done
	if len(results) != 2 || results[0].CallID != "call_1" || results[0].Output != "first output" || results[1].CallID != "call_2" || results[1].Output != "second output" {
		t.Fatalf("unexpected ordered results: %+v", results)
	}
}

func TestExecutorReturnsIndependentErrorsForEachCall(t *testing.T) {
	registry := agenttool.NewRegistry()
	toolError := errors.New("tool failed")
	if err := registry.Register(testTool{
		definition: definition("failure", agenttool.ToolEffectReadOnly),
		execute: func(context.Context, json.RawMessage) (any, error) {
			return nil, toolError
		},
	}); err != nil {
		t.Fatal(err)
	}

	results := agenttool.NewExecutor(registry).Execute(t.Context(), []agenttool.ToolCall{
		{ID: "call_1", Name: "failure"},
		{ID: "call_2", Name: "missing"},
	})
	if len(results) != 2 || !errors.Is(results[0].Err, toolError) || !errors.Is(results[1].Err, agenttool.ErrNotRegistered) {
		t.Fatalf("unexpected call errors: %+v", results)
	}
}

func TestExecutorRejectsNonReadOnlyTools(t *testing.T) {
	registry := agenttool.NewRegistry()
	called := false
	if err := registry.Register(testTool{
		definition: definition("write_tool", agenttool.ToolEffectWrite),
		execute: func(context.Context, json.RawMessage) (any, error) {
			called = true
			return "ok", nil
		},
	}); err != nil {
		t.Fatal(err)
	}

	results := agenttool.NewExecutor(registry).Execute(t.Context(), []agenttool.ToolCall{{ID: "call_1", Name: "write_tool"}})
	if len(results) != 1 || !errors.Is(results[0].Err, agenttool.ErrEffectNotAllowed) {
		t.Fatalf("expected ErrEffectNotAllowed, got %+v", results)
	}
	if called {
		t.Fatal("write tool executed without authorization")
	}
}
