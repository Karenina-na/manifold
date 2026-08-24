package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestOpenMigratesAuditTraceIDColumn(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy.db")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`CREATE TABLE audit_events (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'anonymous', request_id TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var columnCount int
	if err := store.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('audit_events') WHERE name = 'trace_id'`).Scan(&columnCount); err != nil {
		t.Fatal(err)
	}
	if columnCount != 1 {
		t.Fatalf("expected trace_id migration, got %d columns", columnCount)
	}
}

func TestContentMetadataPersistsAcrossReads(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	created, err := database.CreateContent(model.Content{Kind: model.ContentKindArticle, Slug: "metadata-test", Title: "Metadata", Body: "Body", Metadata: map[string]any{"readingMinutes": float64(4)}})
	if err != nil {
		t.Fatal(err)
	}
	read, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if read.Metadata["readingMinutes"] != float64(4) {
		t.Fatalf("expected metadata to persist, got %#v", read.Metadata)
	}
}

func TestOpenMigratesLegacyContentKinds(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy-content.db")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`CREATE TABLE content (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('POST', 'NOTE', 'RESEARCH')), status TEXT NOT NULL DEFAULT 'DRAFT', slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO content (id, kind, status, slug, title, body) VALUES ('legacy_1', 'POST', 'PUBLISHED', 'legacy-post', 'Legacy post', 'Body');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	content, err := store.GetContent("legacy-post", false)
	if err != nil {
		t.Fatal(err)
	}
	if content.Kind != model.ContentKindArticle || content.Metadata == nil {
		t.Fatalf("expected legacy POST to become ARTICLE metadata, got kind=%q metadata=%#v", content.Kind, content.Metadata)
	}
	var foreignKeys int
	if err := store.DB.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if foreignKeys != 1 {
		t.Fatalf("expected foreign keys to be re-enabled, got %d", foreignKeys)
	}
	created, err := store.CreateContent(model.Content{Kind: model.ContentKindThought, Slug: "after-migration", Title: "After", Body: "Body", Metadata: map[string]any{}})
	if err != nil || created.ID == "" {
		t.Fatalf("expected new content after migration, got content=%#v err=%v", created, err)
	}
}
