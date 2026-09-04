package store

import (
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestMediaReferences(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "uses-media", Body: "See ![alt](/api/v1/media/media_1)"})
	if err != nil {
		t.Fatal(err)
	}
	refs, err := database.MediaReferences("media_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].ContentID != created.ID || refs[0].Kind != model.ContentKindArticle {
		t.Fatalf("expected one article reference, got %+v", refs)
	}
	if refs[0].Title != nil {
		t.Fatalf("expected null title, got %q", *refs[0].Title)
	}
	if refs[0].Status != model.StatusDraft {
		t.Fatalf("expected draft reference, got %q", refs[0].Status)
	}
	none, err := database.MediaReferences("media_missing")
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Fatalf("expected no references, got %+v", none)
	}
}
