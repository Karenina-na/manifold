package runtime_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentcompact "github.com/manifold-space/manifold/app/core/internal/agent/conversation/compact"
	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	memorytools "github.com/manifold-space/manifold/app/core/internal/agent/memory/tools"
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

type scriptedCompactor struct {
	requests  []agentcompact.Request
	summaries []string
	err       error
}

func (c *scriptedCompactor) Compact(_ context.Context, request agentcompact.Request) (string, error) {
	c.requests = append(c.requests, request)
	if c.err != nil {
		return "", c.err
	}
	summary := c.summaries[0]
	c.summaries = c.summaries[1:]
	return summary, nil
}

func TestContextBuilderDoesNotAdvanceTheSummaryWhenCompactionFails(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "turn one"},
		{Role: "assistant", Content: "answer one"},
		{Role: "user", Content: "turn two"},
		{Role: "assistant", Content: "answer two"},
		{Role: "user", Content: "turn three"},
		{Role: "assistant", Content: "answer three"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	builder := agentruntime.NewContextBuilder(
		history,
		agentprompt.Spec{Intro: "System prompt"},
		agenttool.NewRegistry(),
		4,
		1,
		&scriptedCompactor{err: errors.New("provider unavailable")},
	)
	if _, err := builder.Build(t.Context(), "session_1", "next"); err == nil || !strings.Contains(err.Error(), "provider unavailable") {
		t.Fatalf("expected compaction failure, got %v", err)
	}
	snapshot, err := history.Snapshot(t.Context(), "session_1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.Content != "" || snapshot.Summary.ThroughSequence != 0 {
		t.Fatalf("failed compaction advanced the checkpoint: %+v", snapshot.Summary)
	}
}

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
	if len(provider.requests[0].Messages) == 0 || !strings.Contains(provider.requests[0].Messages[0].Content, "echo [read-only]: Echo text") || !strings.Contains(provider.requests[0].Messages[0].Content, "Guidance: Use for echoing text.") {
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

func TestRuntimeCompactsBeforeStartingTheProviderRun(t *testing.T) {
	provider := &scriptedProvider{answers: []agentprovider.ChatResponse{
		{Content: "Working state summary", FinishReason: agentprovider.FinishStop, Usage: agentprovider.Usage{TotalTokens: 7}},
		{Content: "Current answer", FinishReason: agentprovider.FinishStop, Usage: agentprovider.Usage{InputTokens: 5, OutputTokens: 2, TotalTokens: 7}},
	}}
	providers := agentprovider.NewRegistry()
	if err := providers.Register("test", provider); err != nil {
		t.Fatal(err)
	}
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "old question"},
		{Role: "assistant", Content: "old answer"},
		{Role: "user", Content: "recent question"},
		{Role: "assistant", Content: "recent answer"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	runtime := agentruntime.NewRuntime(
		agentruntime.RuntimeConfig{Provider: "test", Model: "test-model", HistoryLimit: 4, CompactionRecentTurns: 1, CompactionMaxOutputTokens: 768},
		providers,
		agentscenario.Scenario{Prompt: agentprompt.Spec{Intro: "System prompt"}, Tools: agenttool.NewRegistry()},
		history,
	)
	var events []agentruntime.StreamEvent
	if err := runtime.Run(t.Context(), "session_1", "current question", func(event agentruntime.StreamEvent) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(provider.requests) != 2 || len(provider.requests[0].Tools) != 0 || provider.requests[0].Options.MaxOutputTokens != 768 {
		t.Fatalf("expected one compactor call followed by one runtime call: %+v", provider.requests)
	}
	mainMessages := provider.requests[1].Messages
	if len(mainMessages) != 5 || mainMessages[1].Role != agentprovider.RoleContext || !strings.Contains(mainMessages[1].Content, "Working state summary") || mainMessages[2].Content != "recent question" || mainMessages[4].Content != "current question" {
		t.Fatalf("unexpected main provider context: %+v", mainMessages)
	}
	if events[0].Type != agentruntime.EventRunStarted || events[len(events)-1].Usage == nil || events[len(events)-1].Usage.TotalTokens != 7 {
		t.Fatalf("compaction must finish before run events and remain outside run usage: %+v", events)
	}
}

func TestRuntimeBuildContextExposesTheCurrentPromptAndConversationAssembly(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	if _, err := history.Append(t.Context(), "session-a", agentconversation.Message{Role: "user", Content: "Earlier question"}); err != nil {
		t.Fatal(err)
	}
	if _, err := history.Append(t.Context(), "session-a", agentconversation.Message{Role: "assistant", Content: "Earlier answer"}); err != nil {
		t.Fatal(err)
	}
	tools := agenttool.NewRegistry()
	if err := tools.Register(echoTool{}); err != nil {
		t.Fatal(err)
	}
	runtime := agentruntime.NewRuntime(
		agentruntime.RuntimeConfig{HistoryLimit: 20},
		agentprovider.NewRegistry(),
		agentscenario.Scenario{Prompt: agentprompt.Spec{Intro: "System prompt"}, Tools: tools},
		history,
	)

	messages, err := runtime.BuildContext(t.Context(), "session-a", "Current question")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 4 || messages[0].Role != agentprovider.RoleSystem || messages[0].Content != "System prompt\n\nAVAILABLE TOOLS\n- The following registered tools are available for this run.\n- echo [read-only]: Echo text\n  Guidance: Use for echoing text.\n\nCAPABILITY BOUNDARIES\n- Only registered tools are available for this run.\n- Each tool may act only within its declared effect and scope.\n- A tool's existence does not grant capabilities beyond its declared effect.\n- Read-only tools do not change state; session-write tools may change only temporary state bound to the current session." || messages[1].Content != "Earlier question" || messages[2].Content != "Earlier answer" || messages[3].Content != "Current question" {
		t.Fatalf("unexpected runtime context: %+v", messages)
	}
}

func TestRuntimeBindsTheCurrentSessionForMemoryTools(t *testing.T) {
	provider := &scriptedProvider{answers: []agentprovider.ChatResponse{
		{ToolCalls: []agenttool.ToolCall{{ID: "call_1", Name: "manage_memory", Arguments: json.RawMessage(`{"action":"add","content":"Use SQLite"}`)}}, FinishReason: agentprovider.FinishToolCalls},
		{Content: "Remembered.", FinishReason: agentprovider.FinishStop},
	}}
	providers := agentprovider.NewRegistry()
	if err := providers.Register("test", provider); err != nil {
		t.Fatal(err)
	}
	memories := agentmemory.NewInMemory()
	tools := agenttool.NewRegistry()
	if err := tools.Register(memorytools.Manage{Store: memories}); err != nil {
		t.Fatal(err)
	}
	runtime := agentruntime.NewRuntime(
		agentruntime.RuntimeConfig{Provider: "test", Model: "test-model", MaxToolRounds: 2},
		providers,
		agentscenario.Scenario{Prompt: agentprompt.Spec{Intro: "System prompt"}, Tools: tools},
		agentconversation.NewVolatileHistory(),
	)

	if err := runtime.Run(t.Context(), "session-a", "Remember the database choice", func(agentruntime.StreamEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	items, err := memories.Search(t.Context(), "session-a", "SQLite")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Content != "Use SQLite" {
		t.Fatalf("memory tool did not use the runtime session: %+v", items)
	}
	items, err = memories.Search(t.Context(), "session-b", "SQLite")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("memory leaked into another session: %+v", items)
	}
}

func TestContextBuilderIncrementallyCompactsHistoryAndKeepsRecentTurns(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "turn one"},
		{Role: "assistant", Content: "answer one"},
		{Role: "user", Content: "turn two"},
		{Role: "assistant", Content: "answer two"},
		{Role: "user", Content: "turn three"},
		{Role: "assistant", Content: "answer three"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	compactor := &scriptedCompactor{summaries: []string{"Summary V1", "Summary V2"}}
	builder := agentruntime.NewContextBuilder(history, agentprompt.Spec{Intro: "System prompt"}, agenttool.NewRegistry(), 4, 1, compactor)
	messages, err := builder.Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 5 || messages[0].Role != agentprovider.RoleSystem || messages[1].Role != agentprovider.RoleContext || !strings.Contains(messages[1].Content, "Summary V1") || messages[2].Content != "turn three" || messages[4].Content != "next" {
		t.Fatalf("unexpected context: %+v", messages)
	}
	if len(compactor.requests) != 1 || compactor.requests[0].PreviousSummary != "" || len(compactor.requests[0].Messages) != 4 {
		t.Fatalf("unexpected first compaction request: %+v", compactor.requests)
	}

	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "turn four"},
		{Role: "assistant", Content: "answer four"},
		{Role: "user", Content: "turn five"},
		{Role: "assistant", Content: "answer five"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	messages, err = builder.Build(t.Context(), "session_1", "latest")
	if err != nil {
		t.Fatal(err)
	}
	if len(compactor.requests) != 2 || compactor.requests[1].PreviousSummary != "Summary V1" || len(compactor.requests[1].Messages) != 4 || compactor.requests[1].Messages[0].Content != "turn three" || compactor.requests[1].Messages[3].Content != "answer four" {
		t.Fatalf("unexpected incremental compaction request: %+v", compactor.requests)
	}
	if len(messages) != 5 || !strings.Contains(messages[1].Content, "Summary V2") || messages[2].Content != "turn five" || messages[4].Content != "latest" {
		t.Fatalf("unexpected context after incremental compaction: %+v", messages)
	}
	stored, err := history.List(t.Context(), "session_1", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 10 {
		t.Fatalf("compaction must not delete UI-visible raw history: %+v", stored)
	}
}

func TestContextBuilderKeepsACompleteRecentTurnAtTheThreshold(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "previous"},
		{Role: "assistant", Content: "previous answer"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}

	messages, err := agentruntime.NewContextBuilder(history, agentprompt.Spec{Intro: "System prompt"}, agenttool.NewRegistry(), 1, 1, &scriptedCompactor{summaries: []string{"summary"}}).Build(t.Context(), "session_1", "next")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 4 || messages[0].Role != agentprovider.RoleSystem || messages[1].Role != agentprovider.RoleUser || messages[1].Content != "previous" || messages[3].Content != "next" {
		t.Fatalf("unexpected context after turn-boundary normalization: %+v", messages)
	}
}

func TestContextBuilderCanForceIncrementalCompaction(t *testing.T) {
	history := agentconversation.NewVolatileHistory()
	for _, message := range []agentconversation.Message{
		{Role: "user", Content: "old"},
		{Role: "assistant", Content: "old answer"},
		{Role: "user", Content: "recent"},
		{Role: "assistant", Content: "recent answer"},
	} {
		if _, err := history.Append(t.Context(), "session_1", message); err != nil {
			t.Fatal(err)
		}
	}
	compactor := &scriptedCompactor{summaries: []string{"Manual summary"}}
	builder := agentruntime.NewContextBuilder(history, agentprompt.Spec{Intro: "System prompt"}, agenttool.NewRegistry(), 40, 1, compactor)

	compacted, err := builder.Compact(t.Context(), "session_1")
	if err != nil {
		t.Fatal(err)
	}
	if !compacted || len(compactor.requests) != 1 || len(compactor.requests[0].Messages) != 2 {
		t.Fatalf("expected one forced compaction request, got compacted=%v requests=%+v", compacted, compactor.requests)
	}
	snapshot, err := history.Snapshot(t.Context(), "session_1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.Content != "Manual summary" || snapshot.Summary.ThroughSequence != 2 || len(snapshot.Messages) != 4 {
		t.Fatalf("unexpected manual compaction checkpoint: %+v", snapshot)
	}

	compacted, err = builder.Compact(t.Context(), "session_1")
	if err != nil || compacted {
		t.Fatalf("expected a no-op after all old turns were compacted, compacted=%v err=%v", compacted, err)
	}
}
