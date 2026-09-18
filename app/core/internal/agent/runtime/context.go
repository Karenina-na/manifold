package runtime

import (
	"context"
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
	for _, item := range recent[start:] {
		role := agentprovider.Role(item.Role)
		if role != agentprovider.RoleUser && role != agentprovider.RoleAssistant {
			continue
		}
		result = append(result, agentprovider.Message{Role: role, Content: item.Content})
	}
	result = append(result, agentprovider.Message{Role: agentprovider.RoleUser, Content: userMessage})
	return result, nil
}

// Compact advances the summary checkpoint immediately when at least one old,
// complete turn exists outside the configured recent-turn window.
func (b *ContextBuilder) Compact(ctx context.Context, sessionID string) (bool, error) {
	snapshot, err := b.history.Snapshot(ctx, sessionID)
	if err != nil {
		return false, err
	}
	plan, ok := b.strategy.Force(snapshot)
	if !ok {
		return false, nil
	}
	if _, err := b.executeCompaction(ctx, sessionID, plan); err != nil {
		return false, err
	}
	return true, nil
}

func (b *ContextBuilder) executeCompaction(ctx context.Context, sessionID string, plan agentcompact.Plan) (string, error) {
	if b.compactor == nil {
		return "", errors.New("conversation compactor is not configured")
	}
	summary, err := b.compactor.Compact(ctx, agentcompact.Request{PreviousSummary: plan.PreviousSummary, Messages: plan.Messages})
	if err != nil {
		return "", fmt.Errorf("compact conversation history: %w", err)
	}
	if err := b.history.SaveSummary(ctx, sessionID, agentconversation.Summary{Content: summary, ThroughSequence: plan.ThroughSequence}); err != nil {
		return "", fmt.Errorf("save conversation summary: %w", err)
	}
	return summary, nil
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
