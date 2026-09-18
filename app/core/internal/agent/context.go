package agent

import (
	"context"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type ContextBuilder struct {
	messages     SessionMessageRepository
	prompt       PromptSpec
	tools        *agenttool.Registry
	historyLimit int
}

func NewContextBuilder(messages SessionMessageRepository, prompt PromptSpec, tools *agenttool.Registry, historyLimit int) *ContextBuilder {
	return &ContextBuilder{messages: messages, prompt: prompt, tools: tools, historyLimit: historyLimit}
}

func (b *ContextBuilder) Build(ctx context.Context, sessionID, userMessage string) ([]Message, error) {
	history, err := b.messages.List(ctx, sessionID, b.historyLimit)
	if err != nil {
		return nil, err
	}
	result := make([]Message, 0, len(history)+2)
	var registeredTools []agenttool.ToolDefinition
	if b.tools != nil {
		registeredTools = b.tools.Definitions()
	}
	if systemPrompt := b.prompt.Build(registeredTools); systemPrompt != "" {
		result = append(result, Message{Role: RoleSystem, Content: systemPrompt})
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
