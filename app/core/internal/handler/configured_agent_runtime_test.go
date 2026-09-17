package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/repository"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func TestConfiguredAgentRuntimeUsesSavedSettingsOnTheNextRun(t *testing.T) {
	var mu sync.Mutex
	models := []string{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		mu.Lock()
		models = append(models, request.Model)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`))
	}))
	t.Cleanup(upstream.Close)

	database, err := store.Open(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	settings, err := database.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.OpenAIAPIKey = "test-key"
	settings.OpenAIBaseURL = upstream.URL
	settings.Model = "model-one"
	if err := database.UpdateAgentSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}

	memory := repository.NewMemory()
	runtime := newConfiguredAgentRuntime(database, agent.Scenario{SystemPrompt: "test", Tools: agent.NewToolRegistry()}, memory)
	if err := runtime.Run(t.Context(), "session-1", "first", func(agent.StreamEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	settings.Model = "model-two"
	if err := database.UpdateAgentSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Run(t.Context(), "session-1", "second", func(agent.StreamEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	messages, err := runtime.List(t.Context(), "session-1", 20)
	if err != nil || len(messages) != 4 {
		t.Fatalf("unexpected session history before clear: messages=%+v err=%v", messages, err)
	}
	if err := runtime.Clear(t.Context(), "session-1"); err != nil {
		t.Fatal(err)
	}
	messages, err = runtime.List(t.Context(), "session-1", 20)
	if err != nil || len(messages) != 0 {
		t.Fatalf("session history was not cleared: messages=%+v err=%v", messages, err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(models) != 2 || models[0] != "model-one" || models[1] != "model-two" {
		t.Fatalf("saved settings were not applied immediately: %v", models)
	}
}
