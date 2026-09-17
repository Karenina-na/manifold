package handler

import (
	"net/http"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent/providers"
)

func TestAgentRunErrorMessageClassifiesProviderFailures(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected string
	}{
		{name: "model", err: &providers.UpstreamError{StatusCode: http.StatusServiceUnavailable, Code: "model_not_found", Message: "No available channel"}, expected: "The configured model is unavailable at the provider. Choose a model returned by the provider."},
		{name: "context", err: &providers.UpstreamError{StatusCode: http.StatusBadRequest, Message: "maximum context length exceeded"}, expected: "The configured output limit exceeds the provider context window. Lower max output tokens."},
		{name: "rate limit", err: &providers.UpstreamError{StatusCode: http.StatusTooManyRequests, Message: "temporarily rate-limited"}, expected: "The provider is rate limited or overloaded. Retry shortly or choose another model."},
		{name: "other", err: &providers.UpstreamError{StatusCode: http.StatusBadRequest, Code: "invalid_request_error", Message: "bad request"}, expected: "The provider rejected the request. Check the Agent model and runtime settings."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := agentRunErrorMessage(tt.err); got != tt.expected {
				t.Fatalf("agentRunErrorMessage() = %q, want %q", got, tt.expected)
			}
		})
	}
}
