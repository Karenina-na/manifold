package agent

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/agent/repository"
)

type ContextBuilder struct {
	messages     repository.MessageRepository
	systemPrompt string
	historyLimit int
}

func NewContextBuilder(messages repository.MessageRepository, systemPrompt string, historyLimit int) *ContextBuilder {
	return &ContextBuilder{messages: messages, systemPrompt: systemPrompt, historyLimit: historyLimit}
}

func (b *ContextBuilder) Build(ctx context.Context, sessionID, userMessage string) ([]Message, error) {
	history, err := b.messages.List(ctx, sessionID, b.historyLimit)
	if err != nil {
		return nil, err
	}
	result := make([]Message, 0, len(history)+2)
	if b.systemPrompt != "" {
		result = append(result, Message{Role: RoleSystem, Content: b.systemPrompt})
	}
	start := 0
	for start < len(history) && Role(history[start].Role) != RoleUser {
		start++
	}
	for _, item := range history[start:] {
		role := Role(item.Role)
		if role != RoleUser && role != RoleAssistant {
			continue
		}
		result = append(result, Message{Role: role, Content: item.Content})
	}
	result = append(result, Message{Role: RoleUser, Content: userMessage})
	return result, nil
}
