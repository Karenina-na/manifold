package compact_test

import (
	"encoding/json"
	"strings"
	"testing"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentcompact "github.com/manifold-space/manifold/app/core/internal/agent/conversation/compact"
)

func TestNormalizerPrunesRetriesDuplicatesAndLargeToolResults(t *testing.T) {
	large := strings.Repeat("private-payload-", 400)
	messages := []agentconversation.Message{
		{Role: "user", Content: "Research this"},
		{Role: "assistant", Content: "The lookup blocked error was recovered; publish remains blocked by permission denied.", Trace: &agentconversation.MessageTrace{Steps: []agentconversation.TraceStep{
			{ID: "failed-first", Kind: "tool", Name: "lookup", Status: "error", Input: map[string]any{"q": "topic"}, Output: map[string]any{"error": "lookup blocked"}},
			{ID: "failed", Kind: "tool", Name: "lookup", Status: "error", Input: map[string]any{"q": "topic"}, Output: map[string]any{"error": "temporary failure"}},
			{ID: "success", Kind: "tool", Name: "lookup", Status: "complete", Input: map[string]any{"q": "topic"}, Output: map[string]any{"value": 1}},
			{ID: "duplicate", Kind: "tool", Name: "lookup", Status: "complete", Input: map[string]any{"q": "topic"}, Output: map[string]any{"value": 1}},
			{ID: "large", Kind: "tool", Name: "download", Status: "complete", Input: map[string]any{"url": "https://example.test"}, Output: map[string]any{"body": large, "status": 200}},
			{ID: "unused-error", Kind: "tool", Name: "probe", Status: "error", Input: map[string]any{"target": "unused"}, Output: map[string]any{"error": "connection reset"}},
			{ID: "blocking-error", Kind: "tool", Name: "publish", Status: "error", Input: map[string]any{"id": "article-1"}, Output: map[string]any{"error": "permission denied", "debug": strings.Repeat("stack", 200)}},
		}}},
	}

	clean := agentcompact.Normalize(messages)
	if len(clean) != 2 || len(clean[1].Tools) != 3 {
		t.Fatalf("unexpected normalized transcript: %+v", clean)
	}
	if clean[1].Tools[0].ID != "duplicate" || clean[1].Tools[0].Status != "complete" {
		t.Fatalf("only the final successful duplicate should remain: %+v", clean[1].Tools)
	}
	raw, err := json.Marshal(clean[1].Tools[1].Output)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "private-payload") || !strings.Contains(string(raw), `"truncated":true`) || !strings.Contains(string(raw), `"bytes"`) {
		t.Fatalf("large output must be replaced by bounded metadata: %s", raw)
	}
	if clean[1].Tools[2].ID != "blocking-error" || clean[1].Tools[2].Status != "error" {
		t.Fatalf("a referenced behavior-changing error must remain as a short fact: %+v", clean[1].Tools[2])
	}
	raw, err = json.Marshal(clean[1].Tools[2].Output)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"error":"permission denied"}` {
		t.Fatalf("retained errors must not carry verbose debug output: %s", raw)
	}
}
