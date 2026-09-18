package tools_test

import (
	"encoding/json"
	"errors"
	"testing"

	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	memorytools "github.com/manifold-space/manifold/app/core/internal/agent/memory/tools"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

func TestManageMemoryAddsUpdatesAndDeletesInTheBoundSession(t *testing.T) {
	store := agentmemory.NewInMemory()
	tool := memorytools.Manage{Store: store}
	ctx := agentmemory.BindSession(t.Context(), "session-a")

	addedResult, err := tool.Execute(ctx, json.RawMessage(`{"action":"add","content":"Prefer concise answers"}`))
	if err != nil {
		t.Fatal(err)
	}
	added := addedResult.(map[string]any)["item"].(agentmemory.Item)
	updatedResult, err := tool.Execute(ctx, json.RawMessage(`{"action":"update","id":"`+added.ID+`","content":"Prefer concise technical answers"}`))
	if err != nil {
		t.Fatal(err)
	}
	updated := updatedResult.(map[string]any)["item"].(agentmemory.Item)
	if updated.ID != added.ID || updated.Content != "Prefer concise technical answers" {
		t.Fatalf("unexpected update result: %+v", updated)
	}
	if _, err := tool.Execute(ctx, json.RawMessage(`{"action":"delete","id":"`+added.ID+`"}`)); err != nil {
		t.Fatal(err)
	}
	items, err := store.Search(t.Context(), "session-a", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("deleted memory remains: %+v", items)
	}
}

func TestManageMemoryValidatesArgumentsAndSessionOwnership(t *testing.T) {
	store := agentmemory.NewInMemory()
	item, err := store.Add(t.Context(), "session-a", "Private decision")
	if err != nil {
		t.Fatal(err)
	}
	tool := memorytools.Manage{Store: store}

	for _, arguments := range []string{
		`{"action":"add"}`,
		`{"action":"update","id":"` + item.ID + `"}`,
		`{"action":"delete"}`,
		`{"action":"replace","id":"` + item.ID + `","content":"no"}`,
	} {
		if _, err := tool.Execute(agentmemory.BindSession(t.Context(), "session-a"), json.RawMessage(arguments)); err == nil {
			t.Fatalf("expected invalid arguments to fail: %s", arguments)
		}
	}
	if _, err := tool.Execute(agentmemory.BindSession(t.Context(), "session-b"), json.RawMessage(`{"action":"delete","id":"`+item.ID+`"}`)); !errors.Is(err, agentmemory.ErrItemNotFound) {
		t.Fatalf("expected another session's item to be hidden, got %v", err)
	}
}

func TestManageMemoryDefinitionUsesSessionWriteEffect(t *testing.T) {
	definition := (memorytools.Manage{}).Definition()
	if definition.Name != "manage_memory" || definition.Effect != agenttool.ToolEffectSessionWrite {
		t.Fatalf("unexpected manage_memory definition: %+v", definition)
	}
}
