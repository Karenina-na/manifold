package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/agent"
)

// UpstreamError carries only the structured metadata needed by the handler to
// classify a provider failure. The upstream response body is never forwarded
// to the browser.
type UpstreamError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *UpstreamError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("OpenAI returned status %d", e.StatusCode)
	}
	return fmt.Sprintf("OpenAI returned status %d (%s)", e.StatusCode, e.Code)
}

type OpenAI struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewOpenAI(apiKey, baseURL string, httpClient *http.Client) *OpenAI {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &OpenAI{apiKey: apiKey, baseURL: NormalizeOpenAIBaseURL(baseURL), httpClient: httpClient}
}

// NormalizeOpenAIBaseURL trims surrounding whitespace, removes trailing
// slashes, and ensures the OpenAI API version path is present.
func NormalizeOpenAIBaseURL(raw string) string {
	normalized := strings.TrimSpace(raw)
	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return normalized
	}

	parsed.Path = strings.TrimRight(parsed.Path, "/")
	hasV1 := false
	for _, segment := range strings.Split(strings.Trim(parsed.Path, "/"), "/") {
		if segment == "v1" {
			hasV1 = true
			break
		}
	}
	if !hasV1 {
		parsed.Path += "/v1"
	}
	parsed.RawPath = ""
	return parsed.String()
}

type responseInput struct {
	Type      string `json:"type,omitempty"`
	Role      string `json:"role,omitempty"`
	Content   string `json:"content,omitempty"`
	CallID    string `json:"call_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
	Output    string `json:"output,omitempty"`
}

type functionTool struct {
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
	Strict      bool            `json:"strict"`
}

type responseRequest struct {
	Model             string            `json:"model"`
	Instructions      string            `json:"instructions,omitempty"`
	Input             []json.RawMessage `json:"input"`
	Tools             []functionTool    `json:"tools,omitempty"`
	ParallelToolCalls bool              `json:"parallel_tool_calls"`
	Store             bool              `json:"store"`
	MaxOutputTokens   int               `json:"max_output_tokens,omitempty"`
}

type responseEnvelope struct {
	Status            string `json:"status"`
	IncompleteDetails *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
	Output []json.RawMessage `json:"output"`
	Usage  struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (p *OpenAI) Chat(ctx context.Context, request agent.ChatRequest) (*agent.ChatResponse, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("OpenAI API key is not configured")
	}
	wire := responseRequest{Model: request.Model, Input: []json.RawMessage{}, Tools: []functionTool{}, Store: false, ParallelToolCalls: false, MaxOutputTokens: request.Options.MaxOutputTokens}
	appendInput := func(value responseInput) error {
		raw, err := json.Marshal(value)
		if err == nil {
			wire.Input = append(wire.Input, raw)
		}
		return err
	}
	for _, message := range request.Messages {
		switch message.Role {
		case agent.RoleSystem:
			wire.Instructions = strings.TrimSpace(strings.Join([]string{wire.Instructions, message.Content}, "\n\n"))
		case agent.RoleUser, agent.RoleAssistant:
			if message.Content != "" {
				if err := appendInput(responseInput{Role: string(message.Role), Content: message.Content}); err != nil {
					return nil, err
				}
			}
			for index, call := range message.ToolCalls {
				if index == 0 {
					wire.Input = append(wire.Input, call.ProviderContext...)
				}
				if err := appendInput(responseInput{Type: "function_call", CallID: call.ID, Name: call.Name, Arguments: string(call.Arguments)}); err != nil {
					return nil, err
				}
			}
		case agent.RoleTool:
			if err := appendInput(responseInput{Type: "function_call_output", CallID: message.ToolCallID, Output: message.Content}); err != nil {
				return nil, err
			}
		}
	}
	for _, tool := range request.Tools {
		wire.Tools = append(wire.Tools, functionTool{Type: "function", Name: tool.Name, Description: tool.Description, Parameters: tool.Parameters, Strict: true})
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/responses", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := p.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("call OpenAI: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read OpenAI response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, decodeUpstreamError(response.StatusCode, body)
	}
	var decoded responseEnvelope
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("decode OpenAI response: %w", err)
	}
	if decoded.Error != nil {
		return nil, &UpstreamError{StatusCode: response.StatusCode, Code: "response_error", Message: decoded.Error.Message}
	}
	result := &agent.ChatResponse{FinishReason: agent.FinishStop, Usage: agent.Usage{InputTokens: decoded.Usage.InputTokens, OutputTokens: decoded.Usage.OutputTokens, TotalTokens: decoded.Usage.TotalTokens}}
	providerContext := []json.RawMessage{}
	for _, rawItem := range decoded.Output {
		var item struct {
			Type      string `json:"type"`
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Content   []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(rawItem, &item); err != nil {
			return nil, fmt.Errorf("decode OpenAI output item: %w", err)
		}
		switch item.Type {
		case "reasoning":
			providerContext = append(providerContext, append(json.RawMessage(nil), rawItem...))
		case "message":
			for _, content := range item.Content {
				if content.Type == "output_text" {
					result.Content += content.Text
				}
			}
		case "function_call":
			result.ToolCalls = append(result.ToolCalls, agent.ToolCall{ID: item.CallID, Name: item.Name, Arguments: json.RawMessage(item.Arguments)})
		}
	}
	if len(result.ToolCalls) > 0 {
		result.ToolCalls[0].ProviderContext = providerContext
	}
	if len(result.ToolCalls) > 0 {
		result.FinishReason = agent.FinishToolCalls
	}
	if decoded.Status == "incomplete" && decoded.IncompleteDetails != nil && decoded.IncompleteDetails.Reason == "max_output_tokens" {
		result.FinishReason = agent.FinishMaxTokens
	}
	if decoded.Status == "failed" {
		result.FinishReason = agent.FinishError
		return nil, fmt.Errorf("OpenAI response failed")
	}
	return result, nil
}

func decodeUpstreamError(statusCode int, body []byte) error {
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return &UpstreamError{StatusCode: statusCode}
	}
	return &UpstreamError{StatusCode: statusCode, Code: envelope.Error.Code, Message: envelope.Error.Message}
}
