package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/seed"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func TestRunDoesNotOpenDatabaseWhenAddressIsInUse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	databasePath := filepath.Join(t.TempDir(), "manifold.db")
	err = run(context.Background(), config.Config{
		Addr:         listener.Addr().String(),
		DatabasePath: databasePath,
	})
	if err == nil {
		t.Fatal("expected startup to fail while the address is in use")
	}
	if _, statErr := os.Stat(databasePath); !os.IsNotExist(statErr) {
		t.Fatalf("database should not be opened before the listener is acquired: %v", statErr)
	}
}

// TestSeedAnchorsForDevContents pins docs/chain.md §4.1: an empty chain seeds
// PUBLISHED contents with content certificates (subject_ref = contentId),
// drafts are left out, and a non-empty chain is never re-seeded.
func TestSeedAnchorsForDevContents(t *testing.T) {
	ctx := t.Context()
	// An explicit empty plan keeps the anchor count deterministic (the store
	// would otherwise default to the 20-item built-in dev seed).
	database, err := store.Open(ctx, ":memory:", store.WithSeedPlan(seed.Plan{}), store.WithAdminCredential("admin", "$2a$10$minimalhashvaluethatisvalid0000000000000000000000"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	published1, err := database.CreateContent(ctx, model.ContentInput{Kind: model.ContentKindArticle, Slug: "seed-a", Body: "Body A"})
	if err != nil {
		t.Fatal(err)
	}
	published2, err := database.CreateContent(ctx, model.ContentInput{Kind: model.ContentKindThought, Slug: "seed-b", Body: "Body B"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := database.CreateContent(ctx, model.ContentInput{Kind: model.ContentKindArticle, Slug: "seed-draft", Body: "Draft body"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{published1.ID, published2.ID} {
		if err := database.SetContentStatus(ctx, id, model.StatusPublished); err != nil {
			t.Fatal(err)
		}
	}

	ledger := chain.NewLedger(database.DB, chain.LedgerConfig{ProofMode: chain.ProofModeSim, BatchSize: 32, MaxBlockAnchors: 500, FlushTimeout: 30 * time.Second, AnchorMaxBytes: 1 << 16})
	if _, err := ledger.EnsureSiteKey(ctx); err != nil {
		t.Fatal(err)
	}
	if err := seedAnchorsForDevContents(ctx, ledger, database); err != nil {
		t.Fatal(err)
	}

	var count int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM chain_anchors`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("empty chain must seed exactly the published contents, got %d", count)
	}
	for _, id := range []string{published1.ID, published2.ID} {
		var ref string
		if err := database.DB.QueryRow(`SELECT subject_ref FROM chain_anchors WHERE source = 'content' AND subject_ref = ?`, id).Scan(&ref); err != nil {
			t.Fatalf("published content %s must carry a seed certificate: %v", id, err)
		}
		if ref != id {
			t.Fatalf("seed certificate ref must be the contentId, got %q", ref)
		}
	}
	var draftCount int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE subject_ref = ?`, draft.ID).Scan(&draftCount); err != nil {
		t.Fatal(err)
	}
	if draftCount != 0 {
		t.Fatalf("draft content must not be seeded, got %d", draftCount)
	}

	// A second pass over a now non-empty chain must be a no-op.
	if err := seedAnchorsForDevContents(ctx, ledger, database); err != nil {
		t.Fatal(err)
	}
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM chain_anchors`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("non-empty chain must not re-seed, got %d", count)
	}
}
