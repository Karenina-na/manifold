package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentcompact "github.com/manifold-space/manifold/app/core/internal/agent/conversation/compact"
	agentprompt "github.com/manifold-space/manifold/app/core/internal/agent/prompt"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type ContextBuilder struct {
	history   agentconversation.History
	prompt    agentprompt.Spec
	tools     *agenttool.Registry
	strategy  agentcompact.BasicStrategy
	compactor agentcompact.Compactor
}

type CompactionState struct {
	Summary           string
	CompactedMessages int
	RecentTurns       int
	AfterMessageID    string
}

type CompactionResult struct {
	Compacted bool
	State     CompactionState
}

func NewContextBuilder(history agentconversation.History, prompt agentprompt.Spec, tools *agenttool.Registry, threshold, recentTurns int, compactor agentcompact.Compactor) *ContextBuilder {
	return &ContextBuilder{
		history: history, prompt: prompt, tools: tools,
		strategy:  agentcompact.BasicStrategy{Threshold: threshold, RecentTurns: recentTurns},
		compactor: compactor,
	}
}

func (b *ContextBuilder) Build(ctx context.Context, sessionID, userMessage string) ([]agentprovider.Message, error) {
	snapshot, err := b.history.Snapshot(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	recent := messagesAfter(snapshot.Messages, snapshot.Summary.ThroughSequence)
	summary := snapshot.Summary.Content
	if plan, ok := b.strategy.Plan(snapshot); ok {
		summary, err = b.executeCompaction(ctx, sessionID, plan)
		if err != nil {
			return nil, err
		}
		recent = plan.Recent
	}

	result := make([]agentprovider.Message, 0, len(recent)+3)
	var registeredTools []agenttool.ToolDefinition
	if b.tools != nil {
		registeredTools = b.tools.Definitions()
	}
	if systemPrompt := agentprompt.Build(b.prompt, registeredTools); systemPrompt != "" {
		result = append(result, agentprovider.Message{Role: agentprovider.RoleSystem, Content: systemPrompt})
	}
	if summary != "" {
		result = append(result, agentcompact.SummaryContext(summary))
	}
	start := 0
	for start < len(recent) && agentprovider.Role(recent[start].Role) != agentprovider.RoleUser {
		start++
	}
	result = appendConversationMessages(result, recent[start:])
	result = append(result, agentprovider.Message{Role: agentprovider.RoleUser, Content: userMessage})
	return result, nil
}

// Compact advances the summary checkpoint immediately when at least one old,
// complete turn exists outside the configured recent-turn window.
func (b *ContextBuilder) Compact(ctx context.Context, sessionID string) (CompactionResult, error) {
	snapshot, err := b.history.Snapshot(ctx, sessionID)
	if err != nil {
		return CompactionResult{}, err
	}
	anchorSequence := snapshot.Summary.AnchorSequence
	if anchorSequence == 0 {
		anchorSequence = snapshot.Summary.ThroughSequence
	}
	state := CompactionState{Summary: snapshot.Summary.Content, CompactedMessages: snapshot.Summary.CompactedMessages, RecentTurns: b.strategy.RecentTurnCount(), AfterMessageID: messageIDAtSequence(snapshot.Messages, anchorSequence)}
	plan, ok := b.strategy.Force(snapshot)
	if !ok {
		return CompactionResult{State: state}, nil
	}
	summary, err := b.executeCompaction(ctx, sessionID, plan)
	if err != nil {
		return CompactionResult{}, err
	}
	return CompactionResult{Compacted: true, State: CompactionState{Summary: summary, CompactedMessages: plan.CompactedMessages, RecentTurns: plan.RecentTurns, AfterMessageID: messageIDAtSequence(snapshot.Messages, plan.AnchorSequence)}}, nil
}

func messageIDAtSequence(messages []agentconversation.Message, sequence uint64) string {
	if sequence == 0 {
		return ""
	}
	for _, message := range messages {
		if message.Sequence == sequence {
			return message.ID
		}
	}
	return ""
}

func (b *ContextBuilder) executeCompaction(ctx context.Context, sessionID string, plan agentcompact.Plan) (string, error) {
	if b.compactor == nil {
		return "", errors.New("conversation compactor is not configured")
	}
	summary, err := b.compactor.Compact(ctx, agentcompact.Request{PreviousSummary: plan.PreviousSummary, Messages: plan.Messages})
	if err != nil {
		return "", fmt.Errorf("compact conversation history: %w", err)
	}
	if err := b.history.SaveSummary(ctx, sessionID, agentconversation.Summary{Content: summary, ThroughSequence: plan.ThroughSequence, AnchorSequence: plan.AnchorSequence, CompactedMessages: plan.CompactedMessages, RecentTurns: plan.RecentTurns}); err != nil {
		return "", fmt.Errorf("save conversation summary: %w", err)
	}
	return summary, nil
}

func appendConversationMessages(result []agentprovider.Message, messages []agentconversation.Message) []agentprovider.Message {
	for _, item := range messages {
		switch agentprovider.Role(item.Role) {
		case agentprovider.RoleUser:
			result = append(result, agentprovider.Message{Role: agentprovider.RoleUser, Content: item.Content})
		case agentprovider.RoleAssistant:
			result = appendAssistantConversation(result, item)
		}
	}
	return result
}

func appendAssistantConversation(result []agentprovider.Message, item agentconversation.Message) []agentprovider.Message {
	if item.Trace == nil {
		return append(result, agentprovider.Message{Role: agentprovider.RoleAssistant, Content: item.Content})
	}
	var batch []agentconversation.TraceStep
	hasToolCall := false
	flush := func() {
		if len(batch) == 0 {
			return
		}
		hasToolCall = true
		assistant := agentprovider.Message{Role: agentprovider.RoleAssistant}
		for _, step := range batch {
			arguments, err := json.Marshal(step.Input)
			if err != nil {
				arguments = json.RawMessage(`null`)
			}
			assistant.ToolCalls = append(assistant.ToolCalls, agenttool.ToolCall{ID: step.ID, Name: step.Name, Arguments: arguments})
		}
		result = append(result, assistant)
		for _, step := range batch {
			output, err := json.Marshal(step.Output)
			if err != nil {
				output = json.RawMessage(`null`)
			}
			result = append(result, agentprovider.Message{Role: agentprovider.RoleTool, Content: string(output), ToolCallID: step.ID})
		}
		batch = nil
	}
	for _, step := range item.Trace.Steps {
		if step.Kind == "reasoning" {
			flush()
			continue
		}
		if step.Kind == "tool" && step.ID != "" && step.Name != "" {
			batch = append(batch, step)
		}
	}
	flush()
	if item.Content != "" || hasToolCall || len(item.Trace.Steps) == 0 {
		result = append(result, agentprovider.Message{Role: agentprovider.RoleAssistant, Content: item.Content})
	}
	return result
}

func messagesAfter(messages []agentconversation.Message, sequence uint64) []agentconversation.Message {
	result := make([]agentconversation.Message, 0, len(messages))
	for _, message := range messages {
		if message.Sequence > sequence {
			result = append(result, message)
		}
	}
	return result
}
