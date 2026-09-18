package runtime

import (
	"context"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentprompt "github.com/manifold-space/manifold/app/core/internal/agent/prompt"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type ContextBuilder struct {
	history      agentconversation.History
	prompt       agentprompt.Spec
	tools        *agenttool.Registry
	historyLimit int
}

func NewContextBuilder(history agentconversation.History, prompt agentprompt.Spec, tools *agenttool.Registry, historyLimit int) *ContextBuilder {
	return &ContextBuilder{history: history, prompt: prompt, tools: tools, historyLimit: historyLimit}
}

func (b *ContextBuilder) Build(ctx context.Context, sessionID, userMessage string) ([]agentprovider.Message, error) {
	history, err := b.history.List(ctx, sessionID, b.historyLimit)
	if err != nil {
		return nil, err
	}
	result := make([]agentprovider.Message, 0, len(history)+2)
	var registeredTools []agenttool.ToolDefinition
	if b.tools != nil {
		registeredTools = b.tools.Definitions()
	}
	if systemPrompt := agentprompt.Build(b.prompt, registeredTools); systemPrompt != "" {
		result = append(result, agentprovider.Message{Role: agentprovider.RoleSystem, Content: systemPrompt})
	}
	start := 0
	for start < len(history) && agentprovider.Role(history[start].Role) != agentprovider.RoleUser {
		start++
	}
	for _, item := range history[start:] {
		role := agentprovider.Role(item.Role)
		if role != agentprovider.RoleUser && role != agentprovider.RoleAssistant {
			continue
		}
		result = append(result, agentprovider.Message{Role: role, Content: item.Content})
	}
	result = append(result, agentprovider.Message{Role: agentprovider.RoleUser, Content: userMessage})
	return result, nil
}
