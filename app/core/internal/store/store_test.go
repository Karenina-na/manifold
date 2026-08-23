package store

import (
	"database/sql"
	"path/filepath"
	"testing"
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
