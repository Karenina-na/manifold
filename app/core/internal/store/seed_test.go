package store

import (
	"path/filepath"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/seed"
)

func countContent(t *testing.T, database *Store) int {
	t.Helper()
	var count int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM content`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestBootstrapPlanLeavesContentEmpty(t *testing.T) {
	plan, err := seed.Bootstrap()
	if err != nil {
		t.Fatal(err)
	}
	database, err := Open(filepath.Join(t.TempDir(), "manifold.db"), WithSeedPlan(plan))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	if count := countContent(t, database); count != 0 {
		t.Fatalf("bootstrap plan must not create content, got %d rows", count)
	}
	profile, err := database.GetProfile()
	if err != nil {
		t.Fatal(err)
	}
	if profile.DisplayName == "" {
		t.Fatal("bootstrap plan must still create the profile singleton")
	}
	siteConfig, err := database.GetSiteConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(siteConfig.Navigation) == 0 || len(siteConfig.Sections) == 0 {
		t.Fatal("bootstrap plan must create navigation and sections")
	}
	if siteConfig.Title != "Manifold" {
		t.Fatalf("site title should defer to the schema default, got %q", siteConfig.Title)
	}
	if _, err := database.GetThoughtConfig(); err != nil {
		t.Fatalf("thoughts_config singleton must exist: %v", err)
	}
	if _, err := database.GetWritingConfig(); err != nil {
		t.Fatalf("writings_config singleton must exist: %v", err)
	}
}

func TestSeedDoesNotResurrectDeletedContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifold.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if count := countContent(t, database); count == 0 {
		t.Fatal("expected dev seed to create content")
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.DB.Exec(`DELETE FROM content`); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}

	third, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer third.Close()
	if count := countContent(t, third); count != 0 {
		t.Fatalf("restarting after deleting all content must not re-import starter data, got %d rows", count)
	}
}

func TestWithSeedPlanAppliesCustomContents(t *testing.T) {
	plan, err := seed.Dev()
	if err != nil {
		t.Fatal(err)
	}
	plan.Contents = []seed.ContentSeed{
		{ID: "custom_1", Kind: model.ContentKindThought, Slug: "custom-draft", Title: "Custom Draft", Body: "Custom body.", Status: model.StatusDraft},
	}
	database, err := Open(":memory:", WithSeedPlan(plan))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	items, err := database.ListContent(true, ContentListOptions{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(items.Items) != 1 || items.Items[0].Slug != "custom-draft" {
		t.Fatalf("custom plan contents not applied: %+v", items.Items)
	}
	if items.Items[0].Status != model.StatusDraft {
		t.Fatalf("expected draft status, got %q", items.Items[0].Status)
	}
	if items.Items[0].PublishedAt != nil {
		t.Fatalf("draft rows must not carry published_at, got %q", *items.Items[0].PublishedAt)
	}
}
