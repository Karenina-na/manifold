package store

import (
	"fmt"
	"io/fs"
	"testing"

	"github.com/manifold-space/manifold/app/core/db"
)

// migrate() builds each migration's path as `migrations/%04d_init.sql` and stops
// at schemaVersion. Nothing checked that the two agree, so the two ways this
// breaks were both silent until a fresh database failed to open:
//
//   - bumping schemaVersion without adding the file (read migration N: file does
//     not exist — on every new install, not on the developer's existing one);
//   - adding a migration under any other name, which the loader never reads and
//     which therefore never runs anywhere.
//
// The embedded filesystem is the schema source of truth, so the invariant is
// asserted directly against it rather than against a database that may already
// be migrated.
func TestEmbeddedMigrationsMatchTheSchemaVersionAndTheLoaderNaming(t *testing.T) {
	entries, err := fs.ReadDir(db.MigrationsFS, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			t.Fatalf("migrations/ must contain only .sql files, found directory %q", entry.Name())
		}
		seen[entry.Name()] = true
	}
	for version := 1; version <= schemaVersion; version++ {
		name := fmt.Sprintf("%04d_init.sql", version)
		if !seen[name] {
			t.Fatalf("schemaVersion is %d but migrations/%s is missing: a fresh database cannot be opened", schemaVersion, name)
		}
		script, err := fs.ReadFile(db.MigrationsFS, "migrations/"+name)
		if err != nil {
			t.Fatal(err)
		}
		if len(script) == 0 {
			t.Fatalf("migrations/%s is empty", name)
		}
	}
	if len(seen) != schemaVersion {
		t.Fatalf("migrations/ holds %d file(s) but schemaVersion is %d: an unreferenced migration never runs", len(seen), schemaVersion)
	}
}
