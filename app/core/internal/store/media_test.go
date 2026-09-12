package store

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

// Concurrent uploads of identical bytes must all succeed. Deduplication used to
// be a SELECT followed by an INSERT, so two uploads could both miss the lookup
// and the loser would fail the UNIQUE(sha256) index — turning the case
// deduplication exists to absorb into a 500. The loser now reads back the
// winner's row.
func TestInsertMediaDeduplicatesConcurrentUploads(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	const uploaders = 8
	const sha = "0f4a1c2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8"
	data := []byte("identical image bytes")

	type outcome struct {
		media   model.Media
		created bool
		err     error
	}
	outcomes := make([]outcome, uploaders)
	start := make(chan struct{})
	var wait sync.WaitGroup
	for index := range outcomes {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			media, created, err := database.InsertMedia("image/png", "logo.png", sha, data)
			outcomes[index] = outcome{media: media, created: created, err: err}
		}(index)
	}
	close(start)
	wait.Wait()

	inserted := 0
	var storedID string
	for index, item := range outcomes {
		if item.err != nil {
			t.Fatalf("upload %d failed: %v", index, item.err)
		}
		if item.created {
			inserted++
			storedID = item.media.ID
		}
	}
	if inserted != 1 {
		t.Fatalf("expected exactly one upload to insert, got %d", inserted)
	}
	for index, item := range outcomes {
		if item.media.ID != storedID {
			t.Fatalf("upload %d returned id %q, want the stored row %q", index, item.media.ID, storedID)
		}
	}
	var rows int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM media WHERE sha256 = ?`, sha).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("expected one media row for the digest, got %d", rows)
	}
}

// Re-uploading known bytes still returns the first row, including its filename:
// the second upload must not rewrite the stored metadata.
func TestInsertMediaReturnsTheExistingRowOnReUpload(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	first, created, err := database.InsertMedia("image/png", "first.png", "aa11", []byte("bytes"))
	if err != nil || !created {
		t.Fatalf("first upload: created=%v err=%v", created, err)
	}
	second, created, err := database.InsertMedia("image/png", "second.png", "aa11", []byte("bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("re-uploading the same digest must not insert")
	}
	if second.ID != first.ID || second.Filename != "first.png" {
		t.Fatalf("expected the stored row back, got %+v", second)
	}
}

// Media ids are random, not timestamp-derived: a clock-derived id is only as
// unique as the clock, so uploads inside one tick collided on the primary key.
func TestInsertMediaIDsAreRandom(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	seen := make(map[string]bool, 64)
	for index := 0; index < 64; index++ {
		media, _, err := database.InsertMedia("image/png", "x.png", fmt.Sprintf("digest-%d", index), []byte{byte(index)})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(media.ID, "media_") {
			t.Fatalf("unexpected id format %q", media.ID)
		}
		if len(media.ID) != len("media_")+32 {
			t.Fatalf("expected a 16-byte hex id, got %q", media.ID)
		}
		if seen[media.ID] {
			t.Fatalf("duplicate id %q", media.ID)
		}
		seen[media.ID] = true
	}
}

// Media ids are `media_<hex>`, and `_` is a LIKE wildcard. Without the ESCAPE
// clause the reference lookup for `media_ab12` also matched a body embedding
// `mediaXab12`, so the admin UI could list content that does not use the file.
func TestMediaReferencesMatchTheIDLiterally(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	media, _, err := database.InsertMedia("image/png", "probe.png", "digest-literal", []byte{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	decoyID := strings.Replace(media.ID, "media_", "mediaX", 1)
	if decoyID == media.ID {
		t.Fatalf("expected the underscore position in %q", media.ID)
	}
	real, err := database.CreateContent(model.ContentInput{
		Kind: model.ContentKindArticle, Slug: "uses-the-media", Title: stringPtr("Uses the media"),
		Body: "![probe](/api/v1/media/" + media.ID + ")",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateContent(model.ContentInput{
		Kind: model.ContentKindArticle, Slug: "decoy-media", Title: stringPtr("Decoy"),
		Body: "![probe](/api/v1/media/" + decoyID + ")",
	}); err != nil {
		t.Fatal(err)
	}

	refs, err := database.MediaReferences(media.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].ContentID != real.ID {
		t.Fatalf("expected exactly the real reference, got %+v", refs)
	}
}
