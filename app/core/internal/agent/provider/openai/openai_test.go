package openai_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	"github.com/manifold-space/manifold/app/core/internal/agent/provider/openai"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestOpenAIProviderMapsResponsesToolCalls(t *testing.T) {
	requestCount := 0
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requestCount++
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["store"] != false || body["parallel_tool_calls"] != true {
			t.Fatalf("unexpected request body: %+v", body)
		}
		if tools, ok := body["tools"].([]any); ok && len(tools) > 0 {
			tool := tools[0].(map[string]any)
			if _, hasUsage := tool["usage"]; hasUsage {
				t.Fatal("prompt-only tool usage must not be sent as provider schema")
			}
			if _, hasEffect := tool["effect"]; hasEffect {
				t.Fatal("runtime tool effect must not be sent as provider schema")
			}
		}
		if requestCount == 2 {
			inputs := body["input"].([]any)
			hasReasoning := false
			for _, input := range inputs {
				item := input.(map[string]any)
				if item["type"] == "reasoning" {
					hasReasoning = true
				}
			}
			if !hasReasoning {
				t.Fatalf("second request did not preserve reasoning context: %+v", inputs)
			}
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"id":"resp_1","status":"completed","output":[{"type":"reasoning","id":"rs_1","summary":[]},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Checking."}]},{"type":"function_call","call_id":"call_1","name":"get_current_time","arguments":"{}"}],"usage":{"input_tokens":12,"output_tokens":4,"total_tokens":16}}`))}, nil
	})}

	openAI := openai.New("secret", "https://api.openai.test/v1", client)
	response, err := openAI.Chat(context.Background(), agentprovider.ChatRequest{
		Model:    "test-model",
		Messages: []agentprovider.Message{{Role: agentprovider.RoleSystem, Content: "Be concise."}, {Role: agentprovider.RoleUser, Content: "What time is it?"}},
		Tools:    []agenttool.ToolDefinition{{Name: "get_current_time", Description: "Current time", Usage: "Use for the current date.", Effect: agenttool.ToolEffectReadOnly, Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Content != "Checking." || len(response.ToolCalls) != 1 || response.ToolCalls[0].ID != "call_1" || response.FinishReason != agentprovider.FinishToolCalls {
		t.Fatalf("unexpected response: %+v", response)
	}
	if len(response.ProviderContext) != 1 {
		t.Fatalf("expected reasoning context to be preserved for the next tool round: %+v", response)
	}
	if response.Usage.TotalTokens != 16 {
		t.Fatalf("unexpected usage: %+v", response.Usage)
	}
	if _, err := openAI.Chat(context.Background(), agentprovider.ChatRequest{Model: "test-model", Messages: []agentprovider.Message{{Role: agentprovider.RoleAssistant, Content: response.Content, ToolCalls: response.ToolCalls, ProviderContext: response.ProviderContext}, {Role: agentprovider.RoleTool, ToolCallID: "call_1", Content: `{"date":"2026-09-17"}`}}}); err != nil {
		t.Fatal(err)
	}
}

func TestOpenAIProviderMapsContextMessagesToInstructions(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var body struct {
			Instructions string           `json:"instructions"`
			Input        []map[string]any `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Instructions != "Stable system prompt\n\nCONVERSATION SUMMARY\nHistorical facts only." {
			t.Fatalf("unexpected instructions: %q", body.Instructions)
		}
		if len(body.Input) != 1 || body.Input[0]["role"] != "user" || body.Input[0]["content"] != "Current question" {
			t.Fatalf("context must not be encoded as a conversational message: %+v", body.Input)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"status":"completed","output":[]}`)),
		}, nil
	})}

	openAI := openai.New("secret", "https://api.openai.test/v1", client)
	_, err := openAI.Chat(t.Context(), agentprovider.ChatRequest{
		Model: "test-model",
		Messages: []agentprovider.Message{
			{Role: agentprovider.RoleSystem, Content: "Stable system prompt"},
			{Role: agentprovider.RoleContext, Content: "CONVERSATION SUMMARY\nHistorical facts only."},
			{Role: agentprovider.RoleUser, Content: "Current question"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestOpenAIProviderNormalizesBaseURL(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		path    string
	}{
		{name: "trims whitespace and adds v1", baseURL: "  https://api.openai.test  ", path: "/v1/responses"},
		{name: "keeps existing v1", baseURL: "https://api.openai.test/v1/", path: "/v1/responses"},
		{name: "keeps nested v1", baseURL: "https://api.openai.test/proxy/v1/", path: "/proxy/v1/responses"},
		{name: "adds v1 after a path prefix", baseURL: "https://api.openai.test/proxy/", path: "/proxy/v1/responses"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != test.path {
					t.Fatalf("unexpected request path: %s", r.URL.Path)
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"status":"completed","output":[]}`)),
				}, nil
			})}
			openAI := openai.New("secret", test.baseURL, client)
			if _, err := openAI.Chat(context.Background(), agentprovider.ChatRequest{Model: "test-model"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOpenAIProviderPreservesSafeUpstreamErrorMetadata(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusServiceUnavailable, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"model_not_found","message":"No available channel for model auto:default"}}`))}, nil
	})}
	openAI := openai.New("secret", "https://api.openai.test/v1", client)
	_, err := openAI.Chat(context.Background(), agentprovider.ChatRequest{Model: "auto:default"})
	if err == nil {
		t.Fatal("expected upstream error")
	}
	var upstream *openai.UpstreamError
	if !errors.As(err, &upstream) || upstream.StatusCode != http.StatusServiceUnavailable || upstream.Code != "model_not_found" || upstream.Message != "No available channel for model auto:default" {
		t.Fatalf("unexpected upstream metadata: %v", err)
	}
}
