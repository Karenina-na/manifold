package agent_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/repository"
)

type scriptedProvider struct {
	requests []agent.ChatRequest
	answers  []agent.ChatResponse
}

func (p *scriptedProvider) Chat(_ context.Context, request agent.ChatRequest) (*agent.ChatResponse, error) {
	p.requests = append(p.requests, request)
	answer := p.answers[0]
	p.answers = p.answers[1:]
	return &answer, nil
}

type echoTool struct{}

func (echoTool) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "echo", Description: "Echo text", Parameters: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}`)}
}

func (echoTool) Execute(_ context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(arguments, &input)
	return map[string]string{"text": input.Text}, nil
}

func TestRuntimeCompletesAToolLoopAndStoresConversation(t *testing.T) {
	provider := &scriptedProvider{answers: []agent.ChatResponse{
		{ToolCalls: []agent.ToolCall{{ID: "call_1", Name: "echo", Arguments: json.RawMessage(`{"text":"hello"}`)}}, FinishReason: agent.FinishToolCalls},
		{Content: "Echoed hello.", FinishReason: agent.FinishStop, Usage: agent.Usage{InputTokens: 8, OutputTokens: 3, TotalTokens: 11}},
	}}
	providers := agent.NewProviderRegistry()
	if err := providers.Register("test", provider); err != nil {
		t.Fatal(err)
	}
	toolRegistry := agent.NewToolRegistry()
	if err := toolRegistry.Register(echoTool{}); err != nil {
		t.Fatal(err)
	}
	memory := repository.NewMemory()
	runtime := agent.NewRuntime(agent.RuntimeConfig{Provider: "test", Model: "test-model", MaxToolRounds: 3, HistoryLimit: 20}, providers, agent.Scenario{SystemPrompt: "System prompt", Tools: toolRegistry}, memory)

	var events []agent.StreamEvent
	if err := runtime.Run(t.Context(), "session_1", "Use the echo tool", func(event agent.StreamEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if len(provider.requests) != 2 {
		t.Fatalf("expected two model calls, got %d", len(provider.requests))
	}
	second := provider.requests[1].Messages
	if second[len(second)-1].Role != agent.RoleTool || second[len(second)-1].ToolCallID != "call_1" {
		t.Fatalf("expected tool output in the second model call, got %+v", second)
	}
	if events[0].Type != agent.EventRunStarted || events[len(events)-1].Type != agent.EventRunCompleted {
		t.Fatalf("unexpected event sequence: %+v", events)
	}
	if events[0].MessageID == "" {
		t.Fatalf("run.started must identify the persisted user message: %+v", events[0])
	}
	messages, err := memory.List(t.Context(), "session_1", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Role != "user" || messages[1].Content != "Echoed hello." {
		t.Fatalf("unexpected stored conversation: %+v", messages)
	}
	if messages[1].Trace == nil {
		t.Fatal("expected the assistant message to retain its run trace")
	}
	if len(messages[1].Trace.Steps) != 3 || messages[1].Trace.Steps[0].Kind != "reasoning" || messages[1].Trace.Steps[0].Status != "complete" {
		t.Fatalf("unexpected persisted trace steps: %+v", messages[1].Trace.Steps)
	}
	if messages[1].Trace.Steps[1].Kind != "tool" || messages[1].Trace.Steps[1].Name != "echo" || messages[1].Trace.Steps[1].Status != "complete" || messages[1].Trace.Steps[2].Kind != "reasoning" {
		t.Fatalf("unexpected persisted tool trace: %+v", messages[1].Trace.Steps[1])
	}
	if messages[1].Trace.FinishReason != "stop" || messages[1].Trace.Usage.TotalTokens != 11 {
		t.Fatalf("unexpected persisted trace summary: %+v", messages[1].Trace)
	}
}

func TestContextBuilderLimitsHistoryAndKeepsSystemFirst(t *testing.T) {
	memory := repository.NewMemory()
	for _, message := range []repository.Message{
		{Role: "user", Content: "old"},
		{Role: "assistant", Content: "older answer"},
		{Role: "user", Content: "recent"},
		{Role: "assistant", Content: "recent answer"},
	} {
		if _, err := memory.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	builder := agent.NewContextBuilder(memory, "System prompt", 2)
	messages, err := builder.Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 4 || messages[0].Role != agent.RoleSystem || messages[1].Content != "recent" || messages[3].Content != "next" {
		t.Fatalf("unexpected context: %+v", messages)
	}
}

func TestContextBuilderDropsAnOrphanAssistantAtTheHistoryBoundary(t *testing.T) {
	memory := repository.NewMemory()
	for _, message := range []repository.Message{
		{Role: "user", Content: "previous"},
		{Role: "assistant", Content: "previous answer"},
	} {
		if _, err := memory.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}

	messages, err := agent.NewContextBuilder(memory, "System prompt", 1).Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Role != agent.RoleSystem || messages[1].Role != agent.RoleUser || messages[1].Content != "next" {
		t.Fatalf("unexpected context after turn-boundary normalization: %+v", messages)
	}
}
