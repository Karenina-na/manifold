package runtime_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentprompt "github.com/manifold-space/manifold/app/core/internal/agent/prompt"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	agentruntime "github.com/manifold-space/manifold/app/core/internal/agent/runtime"
	agentscenario "github.com/manifold-space/manifold/app/core/internal/agent/scenario"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type scriptedProvider struct {
	requests []agentprovider.ChatRequest
	answers  []agentprovider.ChatResponse
}

func (p *scriptedProvider) Chat(_ context.Context, request agentprovider.ChatRequest) (*agentprovider.ChatResponse, error) {
	p.requests = append(p.requests, request)
	answer := p.answers[0]
	p.answers = p.answers[1:]
	return &answer, nil
}

type echoTool struct{}

func (echoTool) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{Name: "echo", Description: "Echo text", Usage: "Use for echoing text.", Effect: agenttool.ToolEffectReadOnly, Parameters: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}`)}
}

func (echoTool) Execute(_ context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(arguments, &input)
	return map[string]string{"text": input.Text}, nil
}

func TestRuntimeCompletesAToolLoopAndStoresConversation(t *testing.T) {
	provider := &scriptedProvider{answers: []agentprovider.ChatResponse{
		{ToolCalls: []agenttool.ToolCall{
			{ID: "call_1", Name: "echo", Arguments: json.RawMessage(`{"text":"hello"}`)},
			{ID: "call_2", Name: "echo", Arguments: json.RawMessage(`{"text":"world"}`)},
		}, FinishReason: agentprovider.FinishToolCalls},
		{Content: "Echoed hello and world.", FinishReason: agentprovider.FinishStop, Usage: agentprovider.Usage{InputTokens: 8, OutputTokens: 3, TotalTokens: 11}},
	}}
	providers := agentprovider.NewRegistry()
	if err := providers.Register("test", provider); err != nil {
		t.Fatal(err)
	}
	toolRegistry := agenttool.NewRegistry()
	if err := toolRegistry.Register(echoTool{}); err != nil {
		t.Fatal(err)
	}
	history := agentconversation.NewVolatileHistory()
	runtime := agentruntime.NewRuntime(agentruntime.RuntimeConfig{Provider: "test", Model: "test-model", MaxToolRounds: 3, HistoryLimit: 20}, providers, agentscenario.Scenario{Prompt: agentprompt.Spec{Intro: "System prompt"}, Tools: toolRegistry}, history)

	var events []agentruntime.StreamEvent
	if err := runtime.Run(t.Context(), "session_1", "Use the echo tool", func(event agentruntime.StreamEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if len(provider.requests) != 2 {
		t.Fatalf("expected two model calls, got %d", len(provider.requests))
	}
	if len(provider.requests[0].Messages) == 0 || !strings.Contains(provider.requests[0].Messages[0].Content, "echo: Use for echoing text.") {
		t.Fatalf("registered tool guidance was not built into the system prompt: %+v", provider.requests[0].Messages)
	}
	second := provider.requests[1].Messages
	if second[len(second)-2].Role != agentprovider.RoleTool || second[len(second)-2].ToolCallID != "call_1" || second[len(second)-1].Role != agentprovider.RoleTool || second[len(second)-1].ToolCallID != "call_2" {
		t.Fatalf("expected tool output in the second model call, got %+v", second)
	}
	if events[0].Type != agentruntime.EventRunStarted || events[len(events)-1].Type != agentruntime.EventRunCompleted {
		t.Fatalf("unexpected event sequence: %+v", events)
	}
	if events[0].MessageID == "" {
		t.Fatalf("run.started must identify the persisted user message: %+v", events[0])
	}
	messages, err := history.List(t.Context(), "session_1", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Role != "user" || messages[1].Content != "Echoed hello and world." {
		t.Fatalf("unexpected stored conversation: %+v", messages)
	}
	if messages[1].Trace == nil {
		t.Fatal("expected the assistant message to retain its run trace")
	}
	if len(messages[1].Trace.Steps) != 4 || messages[1].Trace.Steps[0].Kind != "reasoning" || messages[1].Trace.Steps[0].Status != "complete" {
		t.Fatalf("unexpected persisted trace steps: %+v", messages[1].Trace.Steps)
	}
	if messages[1].Trace.Steps[1].Kind != "tool" || messages[1].Trace.Steps[1].Name != "echo" || messages[1].Trace.Steps[1].Status != "complete" || messages[1].Trace.Steps[2].Kind != "tool" || messages[1].Trace.Steps[2].Status != "complete" || messages[1].Trace.Steps[3].Kind != "reasoning" {
		t.Fatalf("unexpected persisted tool trace: %+v", messages[1].Trace.Steps[1])
	}
	if messages[1].Trace.FinishReason != "stop" || messages[1].Trace.Usage.TotalTokens != 11 {
		t.Fatalf("unexpected persisted trace summary: %+v", messages[1].Trace)
	}
}

func TestContextBuilderLimitsHistoryAndKeepsSystemFirst(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "old"},
		{Role: "assistant", Content: "older answer"},
		{Role: "user", Content: "recent"},
		{Role: "assistant", Content: "recent answer"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	builder := agentruntime.NewContextBuilder(history, agentprompt.Spec{Intro: "System prompt"}, agenttool.NewRegistry(), 2)
	messages, err := builder.Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 4 || messages[0].Role != agentprovider.RoleSystem || messages[1].Content != "recent" || messages[3].Content != "next" {
		t.Fatalf("unexpected context: %+v", messages)
	}
}

func TestContextBuilderDropsAnOrphanAssistantAtTheHistoryBoundary(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "previous"},
		{Role: "assistant", Content: "previous answer"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}

	messages, err := agentruntime.NewContextBuilder(history, agentprompt.Spec{Intro: "System prompt"}, agenttool.NewRegistry(), 1).Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].Role != agentprovider.RoleSystem || messages[1].Role != agentprovider.RoleUser || messages[1].Content != "next" {
		t.Fatalf("unexpected context after turn-boundary normalization: %+v", messages)
	}
}
