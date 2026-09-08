package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	coredb "github.com/manifold-space/manifold/app/core/db"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestOpenFreshDatabaseAppliesBaselineSchema(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	for _, table := range []string{"reactions", "now_status", "projects", "tags_json"} {
		var count int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected fresh database without legacy table %s", table)
		}
	}
	for _, legacy := range []struct{ table, column string }{
		{"site_config", "featured_content_json"},
		{"comments", "status"},
	} {
		var column int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, legacy.table, legacy.column).Scan(&column); err != nil {
			t.Fatal(err)
		}
		if column != 0 {
			t.Fatalf("expected %s without legacy column %s", legacy.table, legacy.column)
		}
	}
	for _, table := range []string{"admin_credentials", "admin_sessions"} {
		var count int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 0 {
			t.Fatalf("expected fresh database to include table %s", table)
		}
	}
	var version int
	if err := database.DB.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("expected schema_migrations at %d, got %d", schemaVersion, version)
	}
}

func TestSetContentStatusRejectsMissingAndDeletedRows(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	if err := database.SetContentStatus("missing", model.StatusPublished); err != ErrContentNotFound {
		t.Fatalf("expected not found for missing id, got %v", err)
	}

	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "lifecycle", Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(created.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}
	published, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if published.PublishedAt == nil {
		t.Fatal("expected published_at stamped on first publish")
	}
	originalPublishedAt := *published.PublishedAt

	// published_at is an immutable first-publication fact: unpublish keeps
	// it and republishing does not restamp it.
	if err := database.SetContentStatus(created.ID, model.StatusDraft); err != nil {
		t.Fatal(err)
	}
	draft, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if draft.PublishedAt == nil || *draft.PublishedAt != originalPublishedAt {
		t.Fatalf("expected unpublish to keep original published_at %q, got %#v", originalPublishedAt, draft.PublishedAt)
	}
	if err := database.SetContentStatus(created.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}
	republished, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if republished.PublishedAt == nil || *republished.PublishedAt != originalPublishedAt {
		t.Fatalf("expected republish to keep original published_at %q, got %#v", originalPublishedAt, republished.PublishedAt)
	}

	// Soft-deleted rows cannot be revived through status transitions, but
	// the dedicated restore endpoint returns them to DRAFT.
	if err := database.DeleteContent(created.ID); err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(created.ID, model.StatusPublished); err != ErrContentNotFound {
		t.Fatalf("expected not found for deleted id, got %v", err)
	}
	if err := database.DeleteContent(created.ID); err != ErrContentNotFound {
		t.Fatalf("expected double delete to be not found, got %v", err)
	}
	restored, err := database.RestoreContent(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != model.StatusDraft || restored.PublishedAt == nil {
		t.Fatalf("expected restore to DRAFT with kept published_at, got %s %#v", restored.Status, restored.PublishedAt)
	}
}

func TestSlugIsRequiredAndUnique(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	if _, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "  ", Body: "Body"}); err == nil {
		t.Fatal("expected empty slug to be rejected")
	}
	if _, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "taken", Body: "Body"}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "taken", Body: "Body"}); err != ErrSlugTaken {
		t.Fatalf("expected duplicate slug to be ErrSlugTaken, got %v", err)
	}
	other, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "other", Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	slug := "taken"
	kind := model.ContentKindThought
	title := (*string)(nil)
	summary := ""
	body := "Body"
	tags := []string{}
	if err := database.UpdateContent(other.ID, ContentUpdate{Kind: &kind, Slug: &slug, Title: title, TitleSet: true, Summary: &summary, Body: &body, Tags: &tags, Metadata: json.RawMessage(`{"mood":null,"question":null,"context":null,"source":null}`), ExpectedVersion: other.Version}); err != ErrSlugTaken {
		t.Fatalf("expected slug conflict on update, got %v", err)
	}
}

func TestStatsWordCountIsCjkAware(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	baseline, err := database.Stats()
	if err != nil {
		t.Fatal(err)
	}

	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "cjk-stats", Title: stringPtr("CJK stats"), Body: "hello 世界 foo"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(created.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}

	stats, err := database.Stats()
	if err != nil {
		t.Fatal(err)
	}
	// 2 latin words + 2 CJK characters = 4, versus the space-splitting count
	// that would collapse the whole body into one word.
	if delta := stats.WordCount - baseline.WordCount; delta != 4 {
		t.Fatalf("expected CJK-aware word count delta 4, got %d", delta)
	}
}

func TestCountWordsTreatsEachCjkCharacterAsAWord(t *testing.T) {
	if got := countWords("hello 世界 foo"); got != 4 {
		t.Fatalf("expected 4, got %d", got)
	}
	if got := countWords("全中文段落"); got != 5 {
		t.Fatalf("expected 5 CJK words, got %d", got)
	}
	if got := countWords("one two  three"); got != 3 {
		t.Fatalf("expected 3 latin words, got %d", got)
	}
}

func TestOverviewIgnoresDeletedContentTotals(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "totals", Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetLike(created.ID, "visitor-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateComment(created.ID, "Reader", nil, "A note", nil, "", "visitor", ""); err != nil {
		t.Fatal(err)
	}
	if err := database.DeleteContent(created.ID); err != nil {
		t.Fatal(err)
	}

	overview, err := database.Overview()
	if err != nil {
		t.Fatal(err)
	}
	if overview.Content.TotalLikes != 0 || overview.Content.TotalComments != 0 {
		t.Fatalf("expected soft-deleted content to drop like/comment totals, got %+v", overview.Content)
	}
}

func TestLikeAndCommentCountersArePersisted(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "counters", Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(created.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}

	if err := database.SetLike(created.ID, "visitor-a"); err != nil {
		t.Fatal(err)
	}
	// Idempotent re-like must not double the counter.
	if err := database.SetLike(created.ID, "visitor-a"); err != nil {
		t.Fatal(err)
	}
	comment, err := database.CreateComment(created.ID, "Reader", nil, "A note", nil, "", "visitor", "")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := database.ListContent(false, ContentListOptions{Kinds: []model.ContentKind{model.ContentKindArticle}, Page: 1, PageSize: 50})
	if err != nil {
		t.Fatal(err)
	}
	var counters *model.Content
	for i := range listed.Items {
		if listed.Items[i].Slug == "counters" {
			counters = &listed.Items[i]
		}
	}
	if counters == nil || counters.LikeCount != 1 || counters.CommentCount != 1 {
		t.Fatalf("expected persisted counters on the list row, got %+v", counters)
	}
	if _, err := database.SoftDeleteComment(comment.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.RestoreComment(comment.ID); err != nil {
		t.Fatal(err)
	}
	if err := database.DeleteLike(created.ID, "visitor-a"); err != nil {
		t.Fatal(err)
	}
	after, err := database.GetContentBySlug("counters", true)
	if err != nil {
		t.Fatal(err)
	}
	if after.LikeCount != 0 || after.CommentCount != 1 {
		t.Fatalf("expected counters back to 0/1 after mutations, got %d/%d", after.LikeCount, after.CommentCount)
	}
}

func TestCommentModerationLifecycleKeepsHiddenAndDeletedOrthogonal(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "moderated-comments", Title: stringPtr("Moderated comments"), Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := database.CreateComment(created.ID, "Reader", nil, "Root", nil, "root-seed", "visitor", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateComment(created.ID, "Reply", nil, "Reply", &root.ID, "reply-seed", "visitor", ""); err != nil {
		t.Fatal(err)
	}

	if _, err := database.HideComment(root.ID); err != nil {
		t.Fatal(err)
	}
	content, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if content.CommentCount != 1 {
		t.Fatalf("expected hidden root to leave visible reply counted, got %d", content.CommentCount)
	}
	public, err := database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(public.Comments) != 2 || !public.Comments[0].Hidden || public.Comments[1].Hidden {
		t.Fatalf("expected only root hidden in public thread, got %+v", public.Comments)
	}

	if _, err := database.SoftDeleteComment(root.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.HideComment(root.ID); !errors.Is(err, ErrCommentDeleted) {
		t.Fatalf("expected deleted comment to reject hiding, got %v", err)
	}
	if _, err := database.RestoreComment(root.ID); err != nil {
		t.Fatal(err)
	}
	content, err = database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if content.CommentCount != 1 {
		t.Fatalf("expected restore to retain hidden state and count reply, got %d", content.CommentCount)
	}
	if _, err := database.UnhideComment(root.ID); err != nil {
		t.Fatal(err)
	}
	content, err = database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if content.CommentCount != 2 {
		t.Fatalf("expected unhide to restore the count, got %d", content.CommentCount)
	}
}

func TestUpdateCommentAuthorDistinguishesOmittedAndExplicitNullURL(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindThought, Slug: "edited-comment", Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	comment, err := database.CreateComment(created.ID, "Original", stringPtr("https://original.example"), "Body", nil, "original-seed", "visitor", "")
	if err != nil {
		t.Fatal(err)
	}

	name, url, seed := "Edited", "https://edited.example", "edited-seed"
	if _, err := database.UpdateCommentAuthor(comment.ID, CommentAuthorUpdate{AuthorName: &name, AuthorURL: &url, HasAuthorURL: true, AvatarSeed: &seed}); err != nil {
		t.Fatal(err)
	}
	listed, err := database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Comments) != 1 || listed.Comments[0].AuthorName != name || listed.Comments[0].AuthorURL == nil || *listed.Comments[0].AuthorURL != url || listed.Comments[0].AvatarSeed != seed {
		t.Fatalf("expected updated public author fields, got %+v", listed.Comments)
	}

	if _, err := database.UpdateCommentAuthor(comment.ID, CommentAuthorUpdate{}); err != nil {
		t.Fatal(err)
	}
	listed, err = database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if listed.Comments[0].AuthorURL == nil {
		t.Fatal("expected omitted authorUrl to preserve the existing URL")
	}
	if _, err := database.UpdateCommentAuthor(comment.ID, CommentAuthorUpdate{AuthorURL: nil, HasAuthorURL: true}); err != nil {
		t.Fatal(err)
	}
	listed, err = database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if listed.Comments[0].AuthorURL != nil {
		t.Fatalf("expected explicit null to clear authorUrl, got %v", *listed.Comments[0].AuthorURL)
	}
}

func TestIncrementalCommentMigrationFromSchemaV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-v2.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []int{1, 2} {
		script, err := fs.ReadFile(coredb.MigrationsFS, filepath.Join("migrations", formatMigration(version)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(string(script)); err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := legacy.Exec(`PRAGMA user_version = 2`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var version int
	if err := database.DB.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("expected user_version %d, got %d", schemaVersion, version)
	}
	var hiddenColumn int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('comments') WHERE name = 'hidden_at'`).Scan(&hiddenColumn); err != nil {
		t.Fatal(err)
	}
	if hiddenColumn != 1 {
		t.Fatal("expected incremental migration to add comments.hidden_at")
	}
	var providerColumn, avatarColumn int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('comments') WHERE name = 'author_provider'`).Scan(&providerColumn); err != nil {
		t.Fatal(err)
	}
	if providerColumn != 1 {
		t.Fatal("expected incremental migration to add comments.author_provider")
	}
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('comments') WHERE name = 'author_avatar_url'`).Scan(&avatarColumn); err != nil {
		t.Fatal(err)
	}
	if avatarColumn != 1 {
		t.Fatal("expected incremental migration to add comments.author_avatar_url")
	}
	var identityTable int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'identities'`).Scan(&identityTable); err != nil {
		t.Fatal(err)
	}
	if identityTable != 1 {
		t.Fatal("expected incremental migration to create identities table")
	}
	var pinsColumn int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('thoughts_config') WHERE name = 'featured_thought_id'`).Scan(&pinsColumn); err != nil {
		t.Fatal(err)
	}
	if pinsColumn != 0 {
		t.Fatal("expected incremental migration to drop thoughts_config.featured_thought_id")
	}
}

func TestIncrementalChainMigrationFromSchemaV4(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-v4.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []int{1, 2, 3, 4} {
		script, err := fs.ReadFile(coredb.MigrationsFS, filepath.Join("migrations", formatMigration(version)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(string(script)); err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := legacy.Exec(`PRAGMA user_version = 4`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var version int
	if err := database.DB.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("expected user_version %d, got %d", schemaVersion, version)
	}
	for _, table := range []string{"chain_anchors", "chain_blocks", "chain_keys"} {
		var exists int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists != 1 {
			t.Fatalf("expected incremental migration to create %s", table)
		}
	}
}

func formatMigration(version int) string {
	return fmt.Sprintf("%04d_init.sql", version)
}

func TestListCommentsPaginatesRootsAndKeepsThreadsAttached(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	created, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "paged-comments", Title: stringPtr("Paged comments"), Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, created_at) VALUES
		('root-1', ?, 'Ada', 'First root', '2026-01-01T00:00:00Z'),
		('root-2', ?, 'Grace', 'Second root', '2026-01-02T00:00:00Z'),
		('root-3', ?, 'Linus', 'Third root', '2026-01-03T00:00:00Z'),
		('reply-1', ?, 'Ada', 'needle reply', '2026-01-04T00:00:00Z')`, created.ID, created.ID, created.ID, created.ID); err != nil {
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

	first, err := database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(first.Comments), "root-1,root-2,reply-1"; got != want {
		t.Fatalf("expected first page roots with replies attached, got %s", got)
	}
	if first.Page != 1 || first.PageSize != 2 || first.TotalItems != 4 || first.TotalPages != 2 {
		t.Fatalf("unexpected meta: %+v", first)
	}

	last, err := database.ListComments(created.ID, CommentListOptions{Page: 99, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(last.Comments), "root-3"; got != want {
		t.Fatalf("expected clamped last page, got %s", got)
	}
	if last.Page != 2 {
		t.Fatalf("expected page clamp to 2, got %d", last.Page)
	}

	searched, err := database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 2, Query: "  NEEDLE "})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(searched.Comments), "root-1,reply-1"; got != want {
		t.Fatalf("expected thread-level search hit, got %s", got)
	}
	if searched.TotalItems != 2 || searched.TotalPages != 1 {
		t.Fatalf("unexpected search meta: %+v", searched)
	}

	empty, err := database.ListComments(created.ID, CommentListOptions{Page: 1, PageSize: 2, Query: "zzz"})
	if err != nil {
		t.Fatal(err)
	}
	if empty.Comments == nil || len(empty.Comments) != 0 || empty.TotalItems != 0 || empty.TotalPages != 1 {
		t.Fatalf("expected empty non-nil page, got %+v", empty)
	}
}

func TestArticleMetadataIsDerivedAndTypedOnRead(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	// Client-sent derived fields are ignored in favor of body derivation.
	created, err := database.CreateContent(model.ContentInput{
		Kind: model.ContentKindArticle, Slug: "derived-metadata", Title: stringPtr("Derived metadata"),
		Body:              "## First section\n\nA short paragraph with several words.\n\n### Detail\n\n```md\n## Not a heading\n```\n\n## First section\n\nAnother paragraph.",
		Tags:              []string{},
		EditorialMetadata: json.RawMessage(`{"language":"Go","readingMinutes":99}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	read, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	article := read.ArticleMetadata()
	if article == nil {
		t.Fatal("expected typed ArticleMetadata on read")
	}
	if article.ReadingMinutes != 1 {
		t.Fatalf("expected computed one-minute read, got %d", article.ReadingMinutes)
	}
	if len(article.Toc) != 3 || article.Toc[0].ID != "first-section" || article.Toc[1].Level != 3 || article.Toc[2].ID != "first-section-2" {
		t.Fatalf("unexpected toc: %#v", article.Toc)
	}
	if article.Language == nil || *article.Language != "Go" {
		t.Fatalf("expected editorial language to persist, got %#v", article.Language)
	}
	if read.Excerpt == "" {
		t.Fatal("expected excerpt persisted on write")
	}

	update := json.RawMessage(`{"language":"TypeScript","aiAssisted":false}`)
	kind := model.ContentKindArticle
	slug := created.Slug
	title := created.Title
	summary := created.Summary
	body := "## Updated section\n\n" + strings.Repeat("word ", 450)
	tags := []string{}
	if err := database.UpdateContent(created.ID, ContentUpdate{Kind: &kind, Slug: &slug, Title: title, TitleSet: true, Summary: &summary, Body: &body, Tags: &tags, Metadata: update, ExpectedVersion: created.Version}); err != nil {
		t.Fatal(err)
	}
	updated, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	updatedArticle := updated.ArticleMetadata()
	if updatedArticle.ReadingMinutes != 3 || updatedArticle.Language == nil || *updatedArticle.Language != "TypeScript" {
		t.Fatalf("expected update to recompute derived metadata and preserve language, got %#v", updatedArticle)
	}
}

func TestThoughtMetadataRoundTripsNulls(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mood := "curious"
	created, err := database.CreateContent(model.ContentInput{
		Kind: model.ContentKindThought, Slug: "nulls-metadata", Body: "Body",
		Tags:              []string{},
		EditorialMetadata: json.RawMessage(`{"mood":"` + mood + `"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	read, err := database.GetContentByID(created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	thought := read.ThoughtMetadata()
	if thought == nil {
		t.Fatal("expected typed ThoughtMetadata on read")
	}
	if thought.Mood == nil || *thought.Mood != mood {
		t.Fatalf("expected mood to round-trip, got %#v", thought.Mood)
	}
	if thought.Question != nil || thought.Context != nil || thought.Source != nil {
		t.Fatalf("expected absent fields as nil, got %#v", thought)
	}
	// The wire form must emit keys with null, not omit them.
	raw, err := json.Marshal(model.ToAdminContent(read))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"question":null`, `"context":null`, `"source":null`, `"title":null`, `"publishedAt":null`} {
		if !strings.Contains(string(raw), key) {
			t.Fatalf("expected %s in wire form, got %s", key, raw)
		}
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

func TestTagRowsDriveTagFilters(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	if _, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "tagged-a", Title: stringPtr("Tagged"), Body: "Body", Tags: []string{"go", "design"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "tagged-b", Title: stringPtr("Tagged"), Body: "Body", Tags: []string{"go"}}); err != nil {
		t.Fatal(err)
	}
	tags, err := database.Tags("")
	if err != nil {
		t.Fatal(err)
	}
	// The seeded dev set dominates the aggregate; the assertion below checks
	// the join picks up the two rows created here rather than trusting an exact
	// tag count that would churn with future seed edits.
	byName := map[string]int{}
	for _, tag := range tags {
		byName[tag.Name] = tag.Count
	}
	if len(tags) == 0 || byName["systems"] != 8 || byName["design"] != 7 {
		t.Fatalf("unexpected tag aggregation: %+v", tags)
	}
	filtered, err := database.ListContent(true, ContentListOptions{Tags: []string{"design"}, Page: 1, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	hit := map[string]bool{}
	for _, item := range filtered.Items {
		hit[item.Slug] = true
	}
	// Seed content_1 also carries "design"; both rows created here must resolve
	// through the content_tags join.
	if !hit["tagged-a"] || !hit["designing-boundaries"] {
		t.Fatalf("expected design filter to match seed and new row, got %+v", filtered.Items)
	}
}

func stringPtr(value string) *string { return &value }
