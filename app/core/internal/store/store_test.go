package store

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
)




func TestOpenFreshDatabaseHasNoLegacyTables(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	for _, table := range []string{"reactions", "now_status", "projects"} {
		var count int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected fresh database without legacy table %s", table)
		}
	}
	var featuredColumn int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('site_config') WHERE name = 'featured_content_json'`).Scan(&featuredColumn); err != nil {
		t.Fatal(err)
	}
	if featuredColumn != 0 {
		t.Fatal("expected site_config without featured_content_json")
	}
	var statusColumn int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('comments') WHERE name = 'status'`).Scan(&statusColumn); err != nil {
		t.Fatal(err)
	}
	if statusColumn != 0 {
		t.Fatal("expected comments without legacy moderation status column")
	}
}

func TestListCommentsPaginatesRootsAndKeepsThreadsAttached(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.CreateContent(model.Content{Kind: model.ContentKindArticle, Slug: "paged-comments", Title: "Paged comments", Body: "Body", Metadata: map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	var contentID string
	if err := database.DB.QueryRow(`SELECT id FROM content WHERE slug = 'paged-comments'`).Scan(&contentID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, created_at) VALUES
		('root-1', ?, 'Ada', 'First root', '2026-01-01T00:00:00Z'),
		('root-2', ?, 'Grace', 'Second root', '2026-01-02T00:00:00Z'),
		('root-3', ?, 'Linus', 'Third root', '2026-01-03T00:00:00Z'),
		('reply-1', ?, 'Ada', 'needle reply', '2026-01-04T00:00:00Z')`, contentID, contentID, contentID, contentID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE comments SET reply_to_id = 'root-1' WHERE id = 'reply-1'`); err != nil {
		t.Fatal(err)
	}

	ids := func(comments []model.Comment) string {
		values := make([]string, 0, len(comments))
		for _, comment := range comments {
			values = append(values, comment.ID)
		}
		return strings.Join(values, ",")
	}

	first, err := database.ListComments(contentID, CommentListOptions{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(first.Comments), "root-1,root-2,reply-1"; got != want {
		t.Fatalf("expected first page roots with replies attached, got %s", got)
	}
	if first.Page != 1 || first.PageSize != 2 || first.TotalItems != 4 || first.TotalPages != 2 {
		t.Fatalf("unexpected meta: %+v", first)
	}

	last, err := database.ListComments(contentID, CommentListOptions{Page: 99, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(last.Comments), "root-3"; got != want {
		t.Fatalf("expected clamped last page, got %s", got)
	}
	if last.Page != 2 {
		t.Fatalf("expected page clamp to 2, got %d", last.Page)
	}

	searched, err := database.ListComments(contentID, CommentListOptions{Page: 1, PageSize: 2, Query: "  NEEDLE "})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(searched.Comments), "root-1,reply-1"; got != want {
		t.Fatalf("expected thread-level search hit, got %s", got)
	}
	if searched.TotalItems != 2 || searched.TotalPages != 1 {
		t.Fatalf("unexpected search meta: %+v", searched)
	}

	empty, err := database.ListComments(contentID, CommentListOptions{Page: 1, PageSize: 2, Query: "zzz"})
	if err != nil {
		t.Fatal(err)
	}
	if empty.Comments == nil || len(empty.Comments) != 0 || empty.TotalItems != 0 || empty.TotalPages != 1 {
		t.Fatalf("expected empty non-nil page, got %+v", empty)
	}
}



func TestContentMetadataPersistsAcrossReads(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	created, err := database.CreateContent(model.Content{Kind: model.ContentKindArticle, Slug: "metadata-test", Title: "Metadata", Body: "Body", Metadata: map[string]any{"language": "Go"}})
	if err != nil {
		t.Fatal(err)
	}
	read, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if read.Metadata["language"] != "Go" || read.Metadata["readingMinutes"] != float64(1) {
		t.Fatalf("expected editorial and derived metadata to persist, got %#v", read.Metadata)
	}
}

func TestContentExcerptStripsMarkdownAndCapsLength(t *testing.T) {
	body := "# Heading\n\nA [useful](https://example.com) **thought** with `code`.\n\n![image](assets/preview.png)\n\n- Keep the signal.\n- Drop the noise."
	excerpt := contentExcerpt(body)
	if excerpt != "Heading A useful thought with code. Keep the signal. Drop the noise." {
		t.Fatalf("unexpected markdown excerpt: %q", excerpt)
	}
	long := contentExcerpt(strings.Repeat("word ", 220))
	if len([]rune(long)) > contentExcerptMaxRunes {
		t.Fatalf("excerpt exceeded %d runes: %d", contentExcerptMaxRunes, len([]rune(long)))
	}
}

func TestContentExcerptPreservesOrdinaryPunctuation(t *testing.T) {
	body := "#hashtag\n>quote\nsnake_case a < b && c > d a~b C++\n[reference][id]\n[id]: https://example.com"
	excerpt := contentExcerpt(body)
	if excerpt != "#hashtag quote snake_case a < b && c > d a~b C++ reference" {
		t.Fatalf("unexpected punctuation preservation: %q", excerpt)
	}
}

func TestArticleMetadataIsDerivedFromMarkdown(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	created, err := database.CreateContent(model.Content{
		Kind:     model.ContentKindArticle,
		Slug:     "derived-metadata",
		Title:    "Derived metadata",
		Body:     "## First section\n\nA short paragraph with several words.\n\n### Detail\n\n```md\n## Not a heading\n```\n\n## First section\n\nAnother paragraph.",
		Metadata: map[string]any{"language": "Go", "readingMinutes": float64(99)},
	})
	if err != nil {
		t.Fatal(err)
	}

	read, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if read.Metadata["readingMinutes"] != float64(1) {
		t.Fatalf("expected computed one-minute read, got %#v", read.Metadata["readingMinutes"])
	}
	toc, ok := read.Metadata["toc"].([]any)
	if !ok || len(toc) != 3 {
		t.Fatalf("expected three computed toc entries, got %#v", read.Metadata["toc"])
	}
	if toc[0].(map[string]any)["id"] != "first-section" || toc[1].(map[string]any)["level"] != float64(3) || toc[2].(map[string]any)["id"] != "first-section-2" {
		t.Fatalf("unexpected toc: %#v", toc)
	}

	update := map[string]any{"language": "TypeScript", "readingMinutes": float64(88)}
	if err := database.UpdateContent(created.ID, ContentUpdate{Body: stringPtr("## Updated section\n\n" + strings.Repeat("word ", 450)), Metadata: &update, ExpectedVersion: created.Version}); err != nil {
		t.Fatal(err)
	}
	updated, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata["readingMinutes"] != float64(3) || updated.Metadata["language"] != "TypeScript" {
		t.Fatalf("expected update to recompute derived metadata and preserve language, got %#v", updated.Metadata)
	}
}


func stringPtr(value string) *string { return &value }

