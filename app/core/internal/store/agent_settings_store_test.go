package store

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestAgentSettingsDefaultsAndUpdate(t *testing.T) {
	store, err := Open(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	settings, err := store.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if settings.Provider != "openai" || settings.Model != "gpt-5-mini" || settings.MaxToolRounds != 6 || settings.HistoryLimit != 40 || settings.MaxOutputTokens != 2048 || settings.OpenAIBaseURL != "https://api.openai.com/v1" || settings.OpenAIAPIKey != "" {
		t.Fatalf("unexpected defaults: %+v", settings)
	}

	settings.Model = "gpt-5"
	settings.OpenAIAPIKey = "secret-value"
	if err := store.UpdateAgentSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if updated.Model != "gpt-5" || updated.OpenAIAPIKey != "secret-value" || !updated.View().APIKeyConfigured {
		t.Fatalf("settings update was not persisted: %+v", updated)
	}
}

func TestAgentSettingsViewNeverExposesAPIKey(t *testing.T) {
	settings := mustAgentSettings(t)
	settings.OpenAIAPIKey = "secret-value"
	view := settings.View()
	if !view.APIKeyConfigured {
		t.Fatal("expected configured marker")
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret-value") {
		t.Fatalf("secret leaked in settings view: %s", raw)
	}
}

func mustAgentSettings(t *testing.T) model.AgentSettings {
	t.Helper()
	store, err := Open(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	settings, err := store.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return settings
}
