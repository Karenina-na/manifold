package seed

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestBootstrapPlanHasNoContents(t *testing.T) {
	plan, err := Bootstrap()
	if err != nil {
		t.Fatal(err)
	}
	if plan.Profile.DisplayName == "" {
		t.Fatal("bootstrap profile must define a display name")
	}
	if len(plan.SiteConfig.Navigation) == 0 || len(plan.SiteConfig.Sections) == 0 {
		t.Fatal("bootstrap site config must define navigation and sections")
	}
	if len(plan.Contents) != 0 {
		t.Fatalf("bootstrap must not carry starter content, got %d items", len(plan.Contents))
	}
}

func TestDevPlanMatchesHistoricalSeed(t *testing.T) {
	plan, err := Dev()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"content_1": "designing-boundaries",
		"content_2": "a-small-signal",
		"content_3": "reading-the-edge",
	}
	if len(plan.Contents) != len(want) {
		t.Fatalf("expected %d dev contents, got %d", len(want), len(plan.Contents))
	}
	for _, item := range plan.Contents {
		slug, ok := want[item.ID]
		if !ok || item.Slug != slug {
			t.Fatalf("unexpected dev content %q slug %q", item.ID, item.Slug)
		}
		if item.Status != model.ContentStatus("") && item.Status != model.StatusPublished {
			t.Fatalf("dev content %q should default to PUBLISHED, got %q", item.ID, item.Status)
		}
	}
}

func TestResolveFollowsEnvironment(t *testing.T) {
	devPlan, err := Resolve("development", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devPlan.Contents) == 0 {
		t.Fatal("development resolution should include starter content")
	}

	prodPlan, err := Resolve("production", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(prodPlan.Contents) != 0 {
		t.Fatal("production resolution must drop starter content")
	}
	if prodPlan.Profile.DisplayName != devPlan.Profile.DisplayName || len(prodPlan.Profile.Contacts) != len(devPlan.Profile.Contacts) {
		t.Fatal("production resolution should keep the structural skeleton")
	}
}

func TestLoadFileOverridesAndFallsBack(t *testing.T) {
	document := `{
		"profile": {"displayName": "Custom", "handle": "@custom"},
		"siteConfig": {"title": "Custom Site", "commentsEnabled": false},
		"contents": [
			{"id": "content_9", "kind": "THOUGHT", "slug": "custom-thought", "body": "Custom body.", "status": "DRAFT"}
		]
	}`
	path := filepath.Join(t.TempDir(), "custom.json")
	if err := os.WriteFile(path, []byte(document), 0o644); err != nil {
		t.Fatal(err)
	}
	plan, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Profile.DisplayName != "Custom" || plan.Profile.Handle != "@custom" {
		t.Fatalf("profile override failed: %+v", plan.Profile)
	}
	if plan.Profile.Series == nil {
		t.Fatal("unspecified profile lists should normalize to empty slices, not nil")
	}
	if plan.SiteConfig.Title == nil || *plan.SiteConfig.Title != "Custom Site" {
		t.Fatal("site title override failed")
	}
	if plan.SiteConfig.Description != nil {
		t.Fatal("unspecified site fields should stay nil so column defaults apply")
	}
	if plan.SiteConfig.CommentsEnabled == nil || *plan.SiteConfig.CommentsEnabled {
		t.Fatal("commentsEnabled override failed")
	}
	if plan.SiteConfig.Navigation == nil || len(plan.SiteConfig.Navigation) == 0 {
		t.Fatal("unspecified navigation should fall back to bootstrap defaults")
	}
	if len(plan.Contents) != 1 || plan.Contents[0].Slug != "custom-thought" {
		t.Fatalf("custom contents not loaded: %+v", plan.Contents)
	}
	if plan.Contents[0].Status != model.StatusDraft {
		t.Fatalf("draft status not preserved: %q", plan.Contents[0].Status)
	}
}

func TestLoadFileRejectsUnknownFieldsAndInvalidValues(t *testing.T) {
	cases := map[string]string{
		"unknown field":  `{"profile": {"displayName": "X", "nope": 1}}`,
		"bad kind":       `{"contents": [{"kind": "POEM", "slug": "a"}]}`,
		"bad status":     `{"contents": [{"kind": "THOUGHT", "slug": "a", "status": "DELETED"}]}`,
		"missing slug":   `{"contents": [{"kind": "THOUGHT"}]}`,
		"duplicate slug": `{"contents": [{"kind": "THOUGHT", "slug": "a"}, {"kind": "THOUGHT", "slug": "a"}]}`,
		"bad section":    `{"siteConfig": {"navigation": [{"label": "A", "href": "/"}]}, "siteConfigExtra": null, "sections": ["NOPE"]}`,
		"bad timestamp":  `{"contents": [{"kind": "THOUGHT", "slug": "a", "publishedAt": "yesterday"}]}`,
		"bad metadata":   `{"contents": [{"kind": "THOUGHT", "slug": "a", "metadata": {"language": "Go"}}]}`,
		"empty profile":  `{"profile": {"displayName": "  "}}`,
		"empty navigation": `{"siteConfig": {"navigation": []}}`,
	}
	for name, document := range cases {
		path := filepath.Join(t.TempDir(), "invalid.json")
		if err := os.WriteFile(path, []byte(document), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadFile(path); err == nil {
			t.Fatalf("%s: expected load to fail", name)
		} else if !strings.Contains(err.Error(), "seed file") {
			t.Fatalf("%s: error should mention the file: %v", name, err)
		}
	}
}

func TestWithoutContentsKeepsSkeleton(t *testing.T) {
	plan, err := Dev()
	if err != nil {
		t.Fatal(err)
	}
	trimmed := plan.WithoutContents()
	if len(trimmed.Contents) != 0 {
		t.Fatal("expected contents to be dropped")
	}
	if plan.Profile.DisplayName != trimmed.Profile.DisplayName || len(plan.SiteConfig.Navigation) != len(trimmed.SiteConfig.Navigation) {
		t.Fatal("expected structural skeleton to survive")
	}
}
