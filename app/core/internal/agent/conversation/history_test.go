package conversation_test

import (
	"errors"
	"testing"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
)

func TestVolatileHistoryUndoTruncatesTheSelectedUserMessageAndEverythingAfterIt(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{ID: "user-1", Role: "user", Content: "First"},
		{ID: "assistant-1", Role: "assistant", Content: "First answer"},
		{ID: "user-2", Role: "user", Content: "Revise this"},
		{ID: "assistant-2", Role: "assistant", Content: "Second answer"},
	} {
		if _, err := history.Append(t.Context(), "session-1", message); err != nil {
			t.Fatal(err)
		}
	}

	restored, remaining, err := history.Undo(t.Context(), "session-1", "user-2")
	if err != nil {
		t.Fatal(err)
	}
	if restored.Content != "Revise this" || len(remaining) != 2 || remaining[0].ID != "user-1" || remaining[1].ID != "assistant-1" {
		t.Fatalf("unexpected undo result: restored=%+v remaining=%+v", restored, remaining)
	}
	stored, _ := history.List(t.Context(), "session-1", 200)
	if len(stored) != 2 || stored[1].ID != "assistant-1" {
		t.Fatalf("history was not truncated atomically: %+v", stored)
	}
}

func TestVolatileHistoryUndoRejectsAssistantAndUnknownMessagesWithoutChangingHistory(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	_, _ = history.Append(t.Context(), "session-1", agentconversation.Message{ID: "user-1", Role: "user", Content: "First"})
	_, _ = history.Append(t.Context(), "session-1", agentconversation.Message{ID: "assistant-1", Role: "assistant", Content: "Answer"})

	if _, _, err := history.Undo(t.Context(), "session-1", "assistant-1"); !errors.Is(err, agentconversation.ErrMessageNotUser) {
		t.Fatalf("expected ErrMessageNotUser, got %v", err)
	}
	if _, _, err := history.Undo(t.Context(), "session-1", "missing"); !errors.Is(err, agentconversation.ErrMessageNotFound) {
		t.Fatalf("expected ErrMessageNotFound, got %v", err)
	}
	messages, _ := history.List(t.Context(), "session-1", 200)
	if len(messages) != 2 {
		t.Fatalf("rejected undo changed history: %+v", messages)
	}
}

func TestVolatileHistoryStoresSummarySeparatelyFromRawMessages(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	first, err := history.Append(t.Context(), "session-1", agentconversation.Message{Role: "user", Content: "First"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := history.Append(t.Context(), "session-1", agentconversation.Message{Role: "assistant", Content: "Answer"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Sequence == 0 || second.Sequence <= first.Sequence {
		t.Fatalf("messages must receive monotonically increasing sequences: first=%+v second=%+v", first, second)
	}
	if err := history.SaveSummary(t.Context(), "session-1", agentconversation.Summary{Content: "Working state", ThroughSequence: second.Sequence}); err != nil {
		t.Fatal(err)
	}

	snapshot, err := history.Snapshot(t.Context(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.Content != "Working state" || snapshot.Summary.ThroughSequence != second.Sequence {
		t.Fatalf("unexpected summary: %+v", snapshot.Summary)
	}
	if len(snapshot.Messages) != 2 || snapshot.Messages[0].Content != "First" || snapshot.Messages[1].Content != "Answer" {
		t.Fatalf("summary must not replace raw conversation history: %+v", snapshot.Messages)
	}

	if err := history.Clear(t.Context(), "session-1"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = history.Snapshot(t.Context(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Messages) != 0 || snapshot.Summary.Content != "" {
		t.Fatalf("clear must remove raw history and summary: %+v", snapshot)
	}
}

func TestVolatileHistoryUndoInvalidatesOnlySummariesThatCrossTheNewBoundary(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	var messages []agentconversation.Message
	for _, message := range []agentconversation.Message{
		{ID: "user-1", Role: "user", Content: "First"},
		{ID: "assistant-1", Role: "assistant", Content: "First answer"},
		{ID: "user-2", Role: "user", Content: "Second"},
		{ID: "assistant-2", Role: "assistant", Content: "Second answer"},
		{ID: "user-3", Role: "user", Content: "Third"},
	} {
		stored, err := history.Append(t.Context(), "session-1", message)
		if err != nil {
			t.Fatal(err)
		}
		messages = append(messages, stored)
	}
	if err := history.SaveSummary(t.Context(), "session-1", agentconversation.Summary{Content: "First turn", ThroughSequence: messages[1].Sequence}); err != nil {
		t.Fatal(err)
	}

	if _, _, err := history.Undo(t.Context(), "session-1", "user-3"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := history.Snapshot(t.Context(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.Content != "First turn" {
		t.Fatalf("undo after the compacted boundary must preserve the summary: %+v", snapshot.Summary)
	}

	if _, _, err := history.Undo(t.Context(), "session-1", "user-1"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = history.Snapshot(t.Context(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.Content != "" || snapshot.Summary.ThroughSequence != 0 {
		t.Fatalf("undo across the compacted boundary must invalidate the summary: %+v", snapshot.Summary)
	}
}
