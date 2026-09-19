package tools_test

import (
	"encoding/json"
	"strings"
	"testing"

	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	memorytools "github.com/manifold-space/manifold/app/core/internal/agent/memory/tools"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

func TestSearchMemoryUsesTheBoundSession(t *testing.T) {
	store := agentmemory.NewInMemory()
	if _, err := store.Add(t.Context(), "session-a", "Use SQLite for Core persistence"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add(t.Context(), "session-b", "Use Postgres elsewhere"); err != nil {
		t.Fatal(err)
	}

	result, err := (memorytools.Search{Store: store}).Execute(agentmemory.BindSession(t.Context(), "session-a"), json.RawMessage(`{"query":"sqlite"}`))
	if err != nil {
		t.Fatal(err)
	}
	items := result.(map[string]any)["items"].([]agentmemory.Item)
	if len(items) != 1 || items[0].Content != "Use SQLite for Core persistence" {
		t.Fatalf("unexpected search result: %+v", result)
	}
}

func TestSearchMemoryRequiresABoundSession(t *testing.T) {
	if _, err := (memorytools.Search{Store: agentmemory.NewInMemory()}).Execute(t.Context(), json.RawMessage(`{"query":"sqlite"}`)); err == nil {
		t.Fatal("expected an unbound memory search to fail")
	}
}

func TestSearchMemoryDefinitionIsReadOnly(t *testing.T) {
	definition := (memorytools.Search{}).Definition()
	if definition.Name != "search_memory" || definition.Effect != agenttool.ToolEffectReadOnly {
		t.Fatalf("unexpected search_memory definition: %+v", definition)
	}
	for _, phrase := range []string{
		"Use before answering",
		"prior decision",
		"conversation summary contains an approximate answer",
	} {
		if !strings.Contains(definition.Usage, phrase) {
			t.Fatalf("search_memory usage is missing %q: %q", phrase, definition.Usage)
		}
	}
}
