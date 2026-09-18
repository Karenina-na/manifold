package memory

import (
	"errors"
	"testing"
	"time"
)

func TestInMemoryScopesItemsToSessionAndSearchesContent(t *testing.T) {
	store := NewInMemory()
	first, err := store.Add(t.Context(), "session-a", "Prefer concise architecture notes")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add(t.Context(), "session-b", "Prefer detailed release notes"); err != nil {
		t.Fatal(err)
	}

	items, err := store.Search(t.Context(), "session-a", "ARCHITECTURE")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0] != first {
		t.Fatalf("unexpected session-scoped search results: %+v", items)
	}
	items, err = store.Search(t.Context(), "session-b", "architecture")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("search leaked another session's memory: %+v", items)
	}
}

func TestInMemoryUpdatesAndDeletesOnlyTheOwningSession(t *testing.T) {
	times := []time.Time{
		time.Date(2026, time.September, 18, 10, 0, 0, 0, time.UTC),
		time.Date(2026, time.September, 18, 11, 0, 0, 0, time.UTC),
	}
	store := NewInMemory()
	store.now = func() time.Time {
		value := times[0]
		times = times[1:]
		return value
	}
	item, err := store.Add(t.Context(), "session-a", "Use SQLite")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.Update(t.Context(), "session-a", item.ID, "Use SQLite as the Core store")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Content != "Use SQLite as the Core store" || !updated.CreatedAt.Equal(item.CreatedAt) || !updated.UpdatedAt.Equal(timesForTest(1)) {
		t.Fatalf("unexpected updated item: %+v", updated)
	}
	if _, err := store.Update(t.Context(), "session-b", item.ID, "cross-session update"); !errors.Is(err, ErrItemNotFound) {
		t.Fatalf("expected cross-session update to be hidden, got %v", err)
	}
	if err := store.Delete(t.Context(), "session-b", item.ID); !errors.Is(err, ErrItemNotFound) {
		t.Fatalf("expected cross-session delete to be hidden, got %v", err)
	}
	if err := store.Delete(t.Context(), "session-a", item.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(t.Context(), "session-a", item.ID); !errors.Is(err, ErrItemNotFound) {
		t.Fatalf("expected deleted item to be missing, got %v", err)
	}
}

func TestInMemoryClearsOneSession(t *testing.T) {
	store := NewInMemory()
	if _, err := store.Add(t.Context(), "session-a", "A"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add(t.Context(), "session-b", "B"); err != nil {
		t.Fatal(err)
	}
	if err := store.Clear(t.Context(), "session-a"); err != nil {
		t.Fatal(err)
	}

	itemsA, err := store.Search(t.Context(), "session-a", "")
	if err != nil {
		t.Fatal(err)
	}
	itemsB, err := store.Search(t.Context(), "session-b", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(itemsA) != 0 || len(itemsB) != 1 {
		t.Fatalf("clear affected the wrong sessions: a=%+v b=%+v", itemsA, itemsB)
	}
}

func timesForTest(hour int) time.Time {
	return time.Date(2026, time.September, 18, 10+hour, 0, 0, 0, time.UTC)
}
