package repository

import (
	"errors"
	"testing"
)

func TestMemoryUndoTurnTruncatesTheSelectedUserMessageAndEverythingAfterIt(t *testing.T) {
	memory := NewMemory()
	for _, message := range []Message{
		{ID: "user-1", Role: "user", Content: "First"},
		{ID: "assistant-1", Role: "assistant", Content: "First answer"},
		{ID: "user-2", Role: "user", Content: "Revise this"},
		{ID: "assistant-2", Role: "assistant", Content: "Second answer"},
	} {
		if _, err := memory.Append(t.Context(), "session-1", message); err != nil {
			t.Fatal(err)
		}
	}

	restored, remaining, err := memory.UndoTurn(t.Context(), "session-1", "user-2")
	if err != nil {
		t.Fatal(err)
	}
	if restored.Content != "Revise this" || len(remaining) != 2 || remaining[0].ID != "user-1" || remaining[1].ID != "assistant-1" {
		t.Fatalf("unexpected undo result: restored=%+v remaining=%+v", restored, remaining)
	}
	stored, _ := memory.List(t.Context(), "session-1", 200)
	if len(stored) != 2 || stored[1].ID != "assistant-1" {
		t.Fatalf("history was not truncated atomically: %+v", stored)
	}
}

func TestMemoryUndoTurnRejectsAssistantAndUnknownMessagesWithoutChangingHistory(t *testing.T) {
	memory := NewMemory()
	_, _ = memory.Append(t.Context(), "session-1", Message{ID: "user-1", Role: "user", Content: "First"})
	_, _ = memory.Append(t.Context(), "session-1", Message{ID: "assistant-1", Role: "assistant", Content: "Answer"})

	if _, _, err := memory.UndoTurn(t.Context(), "session-1", "assistant-1"); !errors.Is(err, ErrMessageNotUser) {
		t.Fatalf("expected ErrMessageNotUser, got %v", err)
	}
	if _, _, err := memory.UndoTurn(t.Context(), "session-1", "missing"); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("expected ErrMessageNotFound, got %v", err)
	}
	messages, _ := memory.List(t.Context(), "session-1", 200)
	if len(messages) != 2 {
		t.Fatalf("rejected undo changed history: %+v", messages)
	}
}
