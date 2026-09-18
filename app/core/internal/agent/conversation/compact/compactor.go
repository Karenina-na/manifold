package compact

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
)

type Request struct {
	PreviousSummary string
	Messages        []agentconversation.Message
}

type Compactor interface {
	Compact(ctx context.Context, request Request) (string, error)
}

type LLMCompactor struct {
	provider        agentprovider.Provider
	model           string
	maxOutputTokens int
}

func NewLLMCompactor(provider agentprovider.Provider, model string, maxOutputTokens int) *LLMCompactor {
	if maxOutputTokens < 1 {
		maxOutputTokens = 1024
	}
	return &LLMCompactor{provider: provider, model: model, maxOutputTokens: maxOutputTokens}
}

func (c *LLMCompactor) Compact(ctx context.Context, request Request) (string, error) {
	if c.provider == nil {
		return "", errors.New("compaction provider is not configured")
	}
	payload, err := json.Marshal(struct {
		PreviousSummary string         `json:"previousSummary,omitempty"`
		Messages        []CleanMessage `json:"messages"`
	}{PreviousSummary: request.PreviousSummary, Messages: Normalize(request.Messages)})
	if err != nil {
		return "", fmt.Errorf("encode compaction input: %w", err)
	}
	response, err := c.provider.Chat(ctx, agentprovider.ChatRequest{
		Model: c.model,
		Messages: []agentprovider.Message{
			{Role: agentprovider.RoleSystem, Content: compactorPrompt},
			{Role: agentprovider.RoleUser, Content: string(payload)},
		},
		Options: agentprovider.ChatOptions{MaxOutputTokens: c.maxOutputTokens},
	})
	if err != nil {
		return "", fmt.Errorf("compact conversation: %w", err)
	}
	if response == nil {
		return "", errors.New("compaction provider returned no response")
	}
	if len(response.ToolCalls) > 0 {
		return "", errors.New("compaction provider returned tool calls")
	}
	if response.FinishReason == agentprovider.FinishMaxTokens {
		return "", errors.New("compaction provider stopped at max_tokens")
	}
	if response.FinishReason == agentprovider.FinishError {
		return "", errors.New("compaction provider returned an error finish reason")
	}
	summary := strings.TrimSpace(response.Content)
	if summary == "" {
		return "", errors.New("compaction provider returned an empty summary")
	}
	return summary, nil
}
