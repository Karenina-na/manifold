package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/model"
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

func TestOpenBackfillsThoughtConfigFromSiteFeaturedContent(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy-site.db")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`CREATE TABLE site_config (id TEXT PRIMARY KEY, featured_content_json TEXT NOT NULL DEFAULT '[]', navigation_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
		INSERT INTO site_config (id, featured_content_json) VALUES ('site_1', '[{"id":"content_2","kind":"THOUGHT"}]')`); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	databaseStore, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer databaseStore.Close()

	var featuredThoughtID sql.NullString
	if err := databaseStore.DB.QueryRow(`SELECT featured_thought_id FROM thoughts_config WHERE id = 'thoughts_1'`).Scan(&featuredThoughtID); err != nil {
		t.Fatal(err)
	}
	if !featuredThoughtID.Valid || featuredThoughtID.String != "content_2" {
		t.Fatalf("expected legacy featured thought to be backfilled, got %#v", featuredThoughtID)
	}
}

func TestOpenDropsLegacyReactionsTable(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "reactions.db")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`
CREATE TABLE content (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, slug TEXT, title TEXT, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, view_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reactions (id TEXT PRIMARY KEY);
INSERT INTO content (id, kind, status, slug, title) VALUES ('legacy-content', 'ARTICLE', 'PUBLISHED', 'legacy-content', 'Legacy');

INSERT INTO reactions (id) VALUES ('legacy-reaction');`)
	if err != nil {
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

	var legacyCount int
	if err := store.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'reactions'`).Scan(&legacyCount); err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("expected legacy reactions table to be removed, got %d tables", legacyCount)
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

func TestOpenBackfillsArticleMetadataForExistingRows(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "article-metadata.db")
	database, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES ('legacy_article', 'ARTICLE', 'PUBLISHED', 'legacy-article', 'Legacy article', '', '## Existing heading' || char(10) || char(10) || 'A paragraph.', '[]', '{"language":"Go"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	database, err = Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	content, err := database.GetContent("legacy-article", false)
	if err != nil {
		t.Fatal(err)
	}
	if content.Metadata["language"] != "Go" || content.Metadata["readingMinutes"] != float64(1) {
		t.Fatalf("expected existing article metadata to be backfilled, got %#v", content.Metadata)
	}
	toc, ok := content.Metadata["toc"].([]any)
	if !ok || len(toc) != 1 || toc[0].(map[string]any)["id"] != "existing-heading" {
		t.Fatalf("expected existing article toc to be backfilled, got %#v", content.Metadata["toc"])
	}
}

func stringPtr(value string) *string { return &value }

func TestOpenMigratesLegacyContentKinds(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy-content.db")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`CREATE TABLE content (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('POST', 'NOTE', 'RESEARCH')), status TEXT NOT NULL DEFAULT 'DRAFT', slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
		CREATE TABLE site_config (id TEXT PRIMARY KEY, featured_content_json TEXT NOT NULL DEFAULT '[]', navigation_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
		INSERT INTO content (id, kind, status, slug, title, body) VALUES
			('legacy_1', 'POST', 'PUBLISHED', 'legacy-post', 'Legacy post', 'Body'),
			('legacy_note', 'NOTE', 'PUBLISHED', 'legacy-note', 'Legacy note', 'Note body');
		INSERT INTO site_config (id, featured_content_json) VALUES ('site_1', '[{"id":"legacy_note","kind":"NOTE"}]');`)
	if err != nil {
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

	content, err := store.GetContent("legacy-post", false)
	if err != nil {
		t.Fatal(err)
	}
	if content.Kind != model.ContentKindArticle || content.Metadata == nil {
		t.Fatalf("expected legacy POST to become ARTICLE metadata, got kind=%q metadata=%#v", content.Kind, content.Metadata)
	}
	thoughtConfig, err := store.GetThoughtConfig()
	if err != nil || thoughtConfig.FeaturedThoughtID == nil || *thoughtConfig.FeaturedThoughtID != "legacy_note" {
		t.Fatalf("expected legacy NOTE feature to migrate, got config=%#v err=%v", thoughtConfig, err)
	}
	var archiveIndexCount int
	if err := store.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_content_kind_publication'`).Scan(&archiveIndexCount); err != nil {
		t.Fatal(err)
	}
	if archiveIndexCount != 1 {
		t.Fatalf("expected thought archive index after first migration open, got %d", archiveIndexCount)
	}
	var foreignKeys int
	if err := store.DB.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if foreignKeys != 1 {
		t.Fatalf("expected foreign keys to be re-enabled, got %d", foreignKeys)
	}
	created, err := store.CreateContent(model.Content{Kind: model.ContentKindThought, Slug: "after-migration", Title: "After", Body: "Body", Metadata: map[string]any{}})
	if err != nil || created.ID == "" {
		t.Fatalf("expected new content after migration, got content=%#v err=%v", created, err)
	}
}
