package store

import (
	"path/filepath"
	"testing"
	"time"
)

// foreign_keys is per-connection state, so it has to travel in the DSN. Running
// PRAGMA foreign_keys = ON once after opening only configured the connection it
// happened to run on: the moment the pool retired that connection, the
// comments.reply_to_id, pins.content_id and chain_anchors.block_id foreign keys
// would silently stop being enforced (docs/core.md).
func TestForeignKeysSurviveConnectionRecycling(t *testing.T) {
	ctx := t.Context()
	// A file database rather than ":memory:", because dropping the only
	// connection also drops an in-memory schema.
	database, err := Open(ctx, filepath.Join(t.TempDir(), "foreign-keys.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	// Retire the connection migrate() ran on so the next query must open a new
	// one; without the DSN pragma that replacement comes back with the
	// constraint switched off.
	database.DB.SetConnMaxLifetime(time.Nanosecond)
	database.DB.SetMaxIdleConns(0)

	var enabled int
	if err := database.DB.QueryRow(`PRAGMA foreign_keys`).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 1 {
		t.Fatalf("foreign_keys = %d on a replacement connection, want 1", enabled)
	}
	if _, err := database.DB.Exec(`INSERT INTO content_tags (content_id, tag) VALUES ('content_missing', 'orphan')`); err == nil {
		t.Fatal("expected the content_tags foreign key to reject an orphan row")
	}
}
