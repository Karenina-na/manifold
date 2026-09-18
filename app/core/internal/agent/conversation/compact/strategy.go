package compact

import agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"

type Plan struct {
	PreviousSummary string
	Messages        []agentconversation.Message
	Recent          []agentconversation.Message
	ThroughSequence uint64
}

type BasicStrategy struct {
	Threshold   int
	RecentTurns int
}

func (s BasicStrategy) Plan(snapshot agentconversation.Snapshot) (Plan, bool) {
	return s.plan(snapshot, false)
}

// Force applies the same turn-preserving policy without waiting for the
// automatic message threshold.
func (s BasicStrategy) Force(snapshot agentconversation.Snapshot) (Plan, bool) {
	return s.plan(snapshot, true)
}

func (s BasicStrategy) plan(snapshot agentconversation.Snapshot, force bool) (Plan, bool) {
	threshold := s.Threshold
	if threshold < 1 {
		threshold = 40
	}
	recentTurns := s.RecentTurns
	if recentTurns < 1 {
		recentTurns = 8
	}

	pending := make([]agentconversation.Message, 0, len(snapshot.Messages))
	for _, message := range snapshot.Messages {
		if message.Sequence > snapshot.Summary.ThroughSequence {
			pending = append(pending, message)
		}
	}
	start := 0
	for start < len(pending) && pending[start].Role != "user" {
		start++
	}
	pending = pending[start:]
	if !force && len(pending) < threshold {
		return Plan{}, false
	}

	turns := splitTurns(pending)
	completeCount := 0
	for _, turn := range turns {
		if !turn.complete {
			break
		}
		completeCount++
	}
	compactCount := completeCount - recentTurns
	if compactCount < 1 {
		return Plan{}, false
	}
	end := turns[compactCount-1].end
	selected := append([]agentconversation.Message(nil), pending[:end]...)
	return Plan{
		PreviousSummary: snapshot.Summary.Content,
		Messages:        selected,
		Recent:          append([]agentconversation.Message(nil), pending[end:]...),
		ThroughSequence: selected[len(selected)-1].Sequence,
	}, true
}

type turnBoundary struct {
	end      int
	complete bool
}

func splitTurns(messages []agentconversation.Message) []turnBoundary {
	var turns []turnBoundary
	start := -1
	hasAssistant := false
	for index, message := range messages {
		if message.Role == "user" {
			if start >= 0 {
				turns = append(turns, turnBoundary{end: index, complete: true})
			}
			start = index
			hasAssistant = false
			continue
		}
		if start >= 0 && message.Role == "assistant" {
			hasAssistant = true
		}
	}
	if start >= 0 {
		turns = append(turns, turnBoundary{end: len(messages), complete: hasAssistant})
	}
	return turns
}
