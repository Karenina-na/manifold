package store

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	coredb "github.com/manifold-space/manifold/app/core/db"
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
	if settings.Provider != "openai" || settings.Model != "gpt-5-mini" || settings.MaxToolRounds != 6 || settings.HistoryLimit != 40 || settings.CompactionRecentTurns != 8 || settings.CompactionMaxOutputTokens != 1024 || settings.MaxOutputTokens != 2048 || settings.OpenAIBaseURL != "https://api.openai.com/v1" || settings.OpenAIAPIKey != "" {
		t.Fatalf("unexpected defaults: %+v", settings)
	}

	settings.Model = "gpt-5"
	settings.CompactionRecentTurns = 6
	settings.CompactionMaxOutputTokens = 1536
	settings.OpenAIAPIKey = "secret-value"
	if err := store.UpdateAgentSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if updated.Model != "gpt-5" || updated.CompactionRecentTurns != 6 || updated.CompactionMaxOutputTokens != 1536 || updated.OpenAIAPIKey != "secret-value" || !updated.View().APIKeyConfigured {
		t.Fatalf("settings update was not persisted: %+v", updated)
	}
}

func TestAgentSettingsMigrationAddsCompactionDefaultsWithoutReplacingExistingValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-v7.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for version := 1; version <= 7; version++ {
		script, err := fs.ReadFile(coredb.MigrationsFS, filepath.Join("migrations", formatMigration(version)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(string(script)); err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := legacy.Exec(`UPDATE agent_settings SET model = 'custom-model', history_limit = 1 WHERE id = 'agent_1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`PRAGMA user_version = 7`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	settings, err := store.GetAgentSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if settings.Model != "custom-model" || settings.HistoryLimit != 1 || settings.CompactionRecentTurns != 1 || settings.CompactionMaxOutputTokens != 1024 {
		t.Fatalf("unexpected migrated settings: %+v", settings)
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
