package compact_test

import (
	"testing"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentcompact "github.com/manifold-space/manifold/app/core/internal/agent/conversation/compact"
)

func TestBasicStrategyCompactsCompleteOldTurnsAndKeepsRecentTurnsRaw(t *testing.T) {
	snapshot := agentconversation.Snapshot{
		Summary: agentconversation.Summary{Content: "Summary V1", ThroughSequence: 2},
		Messages: []agentconversation.Message{
			{Role: "user", Content: "already compacted", Sequence: 1},
			{Role: "assistant", Content: "already compacted answer", Sequence: 2},
			{Role: "user", Content: "turn two", Sequence: 3},
			{Role: "assistant", Content: "answer two", Sequence: 4},
			{Role: "user", Content: "turn three", Sequence: 5},
			{Role: "assistant", Content: "answer three", Sequence: 6},
			{Role: "user", Content: "turn four", Sequence: 7},
			{Role: "assistant", Content: "answer four", Sequence: 8},
		},
	}

	plan, ok := (agentcompact.BasicStrategy{Threshold: 4, RecentTurns: 1}).Plan(snapshot)
	if !ok {
		t.Fatal("expected compaction plan")
	}
	if plan.PreviousSummary != "Summary V1" || plan.ThroughSequence != 6 || plan.CompactedMessages != 4 || plan.RecentTurns != 1 {
		t.Fatalf("unexpected incremental boundary: %+v", plan)
	}
	if len(plan.Messages) != 4 || plan.Messages[0].Content != "turn two" || plan.Messages[3].Content != "answer three" {
		t.Fatalf("unexpected messages selected for compaction: %+v", plan.Messages)
	}
	if len(plan.Recent) != 2 || plan.Recent[0].Content != "turn four" || plan.Recent[1].Content != "answer four" {
		t.Fatalf("unexpected recent raw messages: %+v", plan.Recent)
	}
}

func TestBasicStrategyDoesNotSplitIncompleteOrToolBearingTurns(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Content: "old", Sequence: 1},
		{Role: "assistant", Content: "old answer", Sequence: 2, Trace: &agentconversation.MessageTrace{Steps: []agentconversation.TraceStep{
			{ID: "call-1", Kind: "tool", Name: "lookup", Status: "complete", Input: map[string]any{"q": "old"}, Output: map[string]any{"value": 1}},
		}}},
		{Role: "user", Content: "recent", Sequence: 3},
		{Role: "assistant", Content: "recent answer", Sequence: 4},
		{Role: "user", Content: "unfinished", Sequence: 5},
	}}

	plan, ok := (agentcompact.BasicStrategy{Threshold: 3, RecentTurns: 1}).Plan(snapshot)
	if !ok {
		t.Fatal("expected compaction plan")
	}
	if len(plan.Messages) != 2 || plan.Messages[1].Trace == nil || plan.ThroughSequence != 2 {
		t.Fatalf("the complete tool-bearing turn must be selected atomically: %+v", plan.Messages)
	}
	if len(plan.Recent) != 3 || plan.Recent[2].Content != "unfinished" {
		t.Fatalf("the incomplete current turn must remain raw: %+v", plan.Recent)
	}
}

func TestBasicStrategyDropsAnOrphanAssistantBeforeSelectingTurns(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "assistant", Content: "orphan", Sequence: 1},
		{Role: "user", Content: "old", Sequence: 2},
		{Role: "assistant", Content: "old answer", Sequence: 3},
		{Role: "user", Content: "recent", Sequence: 4},
		{Role: "assistant", Content: "recent answer", Sequence: 5},
	}}
	plan, ok := (agentcompact.BasicStrategy{Threshold: 4, RecentTurns: 1}).Plan(snapshot)
	if !ok {
		t.Fatal("expected compaction plan")
	}
	if len(plan.Messages) != 2 || plan.Messages[0].Role != "user" || plan.Messages[0].Content != "old" || plan.ThroughSequence != 3 {
		t.Fatalf("orphan assistant must not enter the compacted turn: %+v", plan)
	}
}

func TestBasicStrategyCompactsAUserOnlyTurnAfterANewerTurnStarts(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Content: "old", Sequence: 1},
		{Role: "assistant", Content: "old answer", Sequence: 2},
		{Role: "user", Content: "failed run", Sequence: 3},
		{Role: "user", Content: "recovery", Sequence: 4},
		{Role: "assistant", Content: "recovered", Sequence: 5},
		{Role: "user", Content: "recent", Sequence: 6},
		{Role: "assistant", Content: "recent answer", Sequence: 7},
	}}
	plan, ok := (agentcompact.BasicStrategy{Threshold: 6, RecentTurns: 1}).Plan(snapshot)
	if !ok {
		t.Fatal("expected compaction plan")
	}
	if len(plan.Messages) != 5 || plan.Messages[2].Content != "failed run" || plan.ThroughSequence != 5 {
		t.Fatalf("a closed user-only turn must not block later compaction: %+v", plan)
	}
}

func TestBasicStrategyCompactsAtTheThresholdBeforeAddingTheCurrentQuery(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Content: "old", Sequence: 1},
		{Role: "assistant", Content: "old answer", Sequence: 2},
		{Role: "user", Content: "recent", Sequence: 3},
		{Role: "assistant", Content: "recent answer", Sequence: 4},
	}}
	plan, ok := (agentcompact.BasicStrategy{Threshold: 4, RecentTurns: 1}).Plan(snapshot)
	if !ok || plan.ThroughSequence != 2 || len(plan.Recent) != 2 {
		t.Fatalf("expected the old turn to compact before the current query exceeds the threshold: %+v", plan)
	}
}

func TestBasicStrategySkipsCompactionBelowThreshold(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Sequence: 1},
		{Role: "assistant", Sequence: 2},
	}}
	if _, ok := (agentcompact.BasicStrategy{Threshold: 3, RecentTurns: 1}).Plan(snapshot); ok {
		t.Fatal("history below the threshold must remain raw")
	}
}

func TestBasicStrategyForceCompactsBelowThresholdAndKeepsRecentTurnsRaw(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Content: "old", Sequence: 1},
		{Role: "assistant", Content: "old answer", Sequence: 2},
		{Role: "user", Content: "recent", Sequence: 3},
		{Role: "assistant", Content: "recent answer", Sequence: 4},
	}}

	plan, ok := (agentcompact.BasicStrategy{Threshold: 40, RecentTurns: 1}).Force(snapshot)
	if !ok {
		t.Fatal("expected forced compaction below the automatic threshold")
	}
	if len(plan.Messages) != 2 || plan.ThroughSequence != 2 || len(plan.Recent) != 2 {
		t.Fatalf("unexpected forced compaction boundary: %+v", plan)
	}
}

func TestBasicStrategyForceIsANoOpWithoutAnOldCompleteTurn(t *testing.T) {
	snapshot := agentconversation.Snapshot{Messages: []agentconversation.Message{
		{Role: "user", Content: "recent", Sequence: 1},
		{Role: "assistant", Content: "recent answer", Sequence: 2},
	}}

	if _, ok := (agentcompact.BasicStrategy{Threshold: 40, RecentTurns: 1}).Force(snapshot); ok {
		t.Fatal("forced compaction must keep the configured recent turn raw")
	}
}
