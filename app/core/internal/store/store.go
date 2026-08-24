package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const schema = `
CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('TECH', 'THOUGHT', 'MANUSCRIPT')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DELETED')), slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS now_status (id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'FOCUSED', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_config (id TEXT PRIMARY KEY, featured_content_json TEXT NOT NULL DEFAULT '[]', navigation_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id), author_name TEXT NOT NULL, author_url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')), reply_to_id TEXT REFERENCES comments(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE, visitor_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('LIKE', 'FAVORITE')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (content_id, visitor_id, kind));
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'anonymous', request_id TEXT NOT NULL DEFAULT '', trace_id TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_content_publication ON content(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_content_status ON comments(content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_content_kind ON reactions(content_id, kind);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
`

type Store struct{ DB *sql.DB }

var (
	ErrContentNotFound = errors.New("content not found")
	ErrVersionConflict = errors.New("content version conflict")
)

type ContentListOptions struct {
	Kinds  []model.ContentKind
	Status string
	Tag    string
	Query  string
	Offset int
	Limit  int
}

type ContentUpdate struct {
	Title           *string
	Summary         *string
	Body            *string
	Tags            *[]string
	Metadata        *map[string]any
	ExpectedVersion int
}

func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA foreign_keys = ON;" + schema); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureSiteConfigColumns(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureAuditEventColumns(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureContentSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.seed(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func ensureContentSchema(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(content)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	hasMetadata := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == "metadata_json" {
			hasMetadata = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var tableSQL string
	if err := db.QueryRow(`SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = 'content'`).Scan(&tableSQL); err != nil {
		return err
	}
	if strings.Contains(tableSQL, "'POST'") || strings.Contains(tableSQL, "'NOTE'") || strings.Contains(tableSQL, "'RESEARCH'") {
		return migrateLegacyContent(db, hasMetadata)
	}
	if !hasMetadata {
		if _, err = db.Exec(`ALTER TABLE content ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`UPDATE content SET metadata_json = CASE kind WHEN 'TECH' THEN '{"technologies":["Unspecified"]}' WHEN 'THOUGHT' THEN '{}' WHEN 'MANUSCRIPT' THEN '{"form":"OTHER","stage":"DRAFT"}' ELSE metadata_json END WHERE TRIM(metadata_json) = '' OR metadata_json = '{}'`)
	return err
}

func migrateLegacyContent(db *sql.DB, hasMetadata bool) error {
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	rollback := func(err error) error {
		_, _ = db.Exec(`PRAGMA foreign_keys = ON`)
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return rollback(err)
	}
	contentTable := `CREATE TABLE content_new (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('TECH', 'THOUGHT', 'MANUSCRIPT')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DELETED')), slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
	if _, err = tx.Exec(contentTable); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	metadataExpression := `CASE kind WHEN 'POST' THEN '{"technologies":["Unspecified"]}' WHEN 'NOTE' THEN '{}' WHEN 'RESEARCH' THEN '{"form":"OTHER","stage":"DRAFT"}' ELSE '{}' END`
	if hasMetadata {
		metadataExpression = `CASE kind WHEN 'POST' THEN '{"technologies":["Unspecified"]}' WHEN 'NOTE' THEN '{}' WHEN 'RESEARCH' THEN '{"form":"OTHER","stage":"DRAFT"}' ELSE CASE WHEN TRIM(metadata_json) = '' THEN '{}' ELSE metadata_json END END`
	}
	query := `INSERT INTO content_new (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, version, updated_at) SELECT id, CASE kind WHEN 'POST' THEN 'TECH' WHEN 'NOTE' THEN 'THOUGHT' WHEN 'RESEARCH' THEN 'MANUSCRIPT' ELSE kind END, status, slug, title, summary, body, tags_json, ` + metadataExpression + `, published_at, created_at, version, updated_at FROM content`
	if _, err = tx.Exec(query); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	if _, err = tx.Exec(`DROP TABLE content`); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	if _, err = tx.Exec(`ALTER TABLE content_new RENAME TO content`); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	if _, err = tx.Exec(`CREATE INDEX IF NOT EXISTS idx_content_publication ON content(status, published_at DESC)`); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	if err = tx.Commit(); err != nil {
		return rollback(err)
	}
	_, err = db.Exec(`PRAGMA foreign_keys = ON`)
	return err
}

func ensureAuditEventColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(audit_events)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	hasTraceID := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == "trace_id" {
			hasTraceID = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !hasTraceID {
		_, err = db.Exec(`ALTER TABLE audit_events ADD COLUMN trace_id TEXT NOT NULL DEFAULT ''`)
	}
	return err
}

func ensureSiteConfigColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(site_config)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, column := range []string{"featured_content_json"} {
		if !columns[column] {
			if _, err := db.Exec(`ALTER TABLE site_config ADD COLUMN ` + column + ` TEXT NOT NULL DEFAULT '[]'`); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) seed() error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO profile (id, display_name, handle, headline, bio, location, organization, website_url, updated_at) VALUES ('profile_1', 'Manifold', '@manifold', 'A living archive for technology, thoughts, and manuscripts.', 'A quiet space for technical records, thoughts, and manuscripts.', 'Peking, China', 'Independent', 'https://manifold.local', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO now_status (id, title, detail, mood, updated_at) VALUES ('now_1', 'Building the first garden', 'Shaping a small API-first space for technology, thoughts, and manuscripts.', 'FOCUSED', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO site_config (id, featured_content_json, navigation_json, sections_json, updated_at) VALUES ('site_1', ?, ?, ?, ?)`, encodeJSON([]model.SiteContentRef{{ID: "content_1", Kind: model.ContentKindTech}}), encodeJSON([]model.SiteNavigationItem{{Label: "Technology", Href: "/writing?kind=TECH"}, {Label: "Thoughts", Href: "/writing?kind=THOUGHT"}, {Label: "Manuscripts", Href: "/writing?kind=MANUSCRIPT"}}), encodeJSON([]string{"PROFILE", "NOW", "TECH", "THOUGHT", "MANUSCRIPT"}), now); err != nil {
		return err
	}
	seedContent := []struct {
		id, kind, slug, title, summary, body, tags, metadata string
	}{
		{"content_1", "TECH", "designing-boundaries", "Designing Boundaries", "A technical note on keeping a personal system calm and extensible.", "# Designing Boundaries\n\nA good personal system leaves room for the next thought without making today harder.", `["systems","design"]`, `{"technologies":["Go","SQLite","Next.js"],"language":"Go","difficulty":"INTERMEDIATE"}`},
		{"content_2", "THOUGHT", "a-small-signal", "A Small Signal", "A thought that needs a place to land before it becomes a system.", "Not every thought needs to become a system. Some only need a place to land.", `["thinking"]`, `{"mood":"Curious","question":"What deserves a place to land?"}`},
		{"content_3", "MANUSCRIPT", "reading-the-edge", "Reading the Edge", "A manuscript for questions between engineering and lived experience.", "## Open question\n\nHow do small tools change the way we notice the world?", `["manuscript","systems"]`, `{"form":"ESSAY","stage":"DRAFT","wordCount":18}`},
	}
	for _, item := range seedContent {
		if _, err := s.DB.Exec(`INSERT OR IGNORE INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.id, item.kind, item.slug, item.title, item.summary, item.body, item.tags, item.metadata, now, now, now); err != nil {
			return err
		}
	}
	return nil
}

func decodeStrings(raw string) []string {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}

func decodeMetadata(raw string) map[string]any {
	values := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &values); err != nil || values == nil {
		return map[string]any{}
	}
	return values
}

func encodeStrings(values []string) string {
	raw, _ := json.Marshal(values)
	return string(raw)
}

func encodeJSON(value any) string {
	raw, err := json.Marshal(value)
	if err == nil {
		return string(raw)
	}
	return "[]"
}

func (s *Store) GetProfile() (model.Profile, error) {
	var p model.Profile
	err := s.DB.QueryRow(`SELECT id, display_name, handle, headline, bio, avatar_url, location, organization, website_url, updated_at FROM profile WHERE id = 'profile_1'`).Scan(&p.ID, &p.DisplayName, &p.Handle, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Organization, &p.WebsiteURL, &p.UpdatedAt)
	return p, err
}

func (s *Store) UpdateProfile(p model.Profile) error {
	_, err := s.DB.Exec(`UPDATE profile SET display_name = ?, handle = ?, headline = ?, bio = ?, avatar_url = ?, location = ?, organization = ?, website_url = ?, updated_at = ? WHERE id = 'profile_1'`, p.DisplayName, p.Handle, p.Headline, p.Bio, p.AvatarURL, p.Location, p.Organization, p.WebsiteURL, time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) GetSiteConfig() (model.SiteConfig, error) {
	var rawFeaturedContent, rawNavigation, rawSections string
	if err := s.DB.QueryRow(`SELECT featured_content_json, navigation_json, sections_json FROM site_config WHERE id = 'site_1'`).Scan(&rawFeaturedContent, &rawNavigation, &rawSections); err != nil {
		return model.SiteConfig{}, err
	}
	var config model.SiteConfig
	if err := json.Unmarshal([]byte(rawFeaturedContent), &config.FeaturedContent); err != nil {
		return model.SiteConfig{}, err
	}
	if err := json.Unmarshal([]byte(rawNavigation), &config.Navigation); err != nil {
		return model.SiteConfig{}, err
	}
	if err := json.Unmarshal([]byte(rawSections), &config.Sections); err != nil {
		return model.SiteConfig{}, err
	}
	return config, nil
}

func (s *Store) UpdateSiteConfig(config model.SiteConfig) error {
	_, err := s.DB.Exec(`UPDATE site_config SET featured_content_json = ?, navigation_json = ?, sections_json = ?, updated_at = ? WHERE id = 'site_1'`, encodeJSON(config.FeaturedContent), encodeJSON(config.Navigation), encodeJSON(config.Sections), time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) ListContent(includeDrafts bool, options ContentListOptions) ([]model.Content, bool, error) {
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version FROM content WHERE 1 = 1`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	} else if options.Status == "" {
		query += ` AND status != 'DELETED'`
	}
	args := make([]any, 0, len(options.Kinds)+4)
	if options.Status != "" {
		query += ` AND status = ?`
		args = append(args, options.Status)
	}
	if len(options.Kinds) > 0 {
		placeholders := make([]string, len(options.Kinds))
		for i, kind := range options.Kinds {
			placeholders[i] = "?"
			args = append(args, kind)
		}
		query += ` AND kind IN (` + strings.Join(placeholders, ",") + `)`
	}
	if options.Tag != "" {
		query += ` AND EXISTS (SELECT 1 FROM json_each(content.tags_json) WHERE json_each.value = ?)`
		args = append(args, options.Tag)
	}
	if options.Query != "" {
		query += ` AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(body) LIKE ?)`
		term := "%" + strings.ToLower(options.Query) + "%"
		args = append(args, term, term, term)
	}
	query += ` ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`
	limit := options.Limit
	if limit <= 0 {
		limit = 20
	}
	args = append(args, limit+1, options.Offset)
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var items []model.Content
	for rows.Next() && len(items) <= limit {
		var c model.Content
		var tags, metadata, published sql.NullString
		if err := rows.Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version); err != nil {
			return nil, false, err
		}
		c.Tags = decodeStrings(tags.String)
		c.Metadata = decodeMetadata(metadata.String)
		if published.Valid {
			c.PublishedAt = &published.String
		}
		c.Href = "/writing/" + c.Slug
		if !includeDrafts {
			c.Body = ""
		}
		items = append(items, c)
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, rows.Err()
}

func (s *Store) GetContent(slug string, includeDrafts bool) (model.Content, error) {
	var c model.Content
	var tags, metadata, published sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version FROM content WHERE slug = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, slug).Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	c.Tags = decodeStrings(tags.String)
	c.Metadata = decodeMetadata(metadata.String)
	if published.Valid {
		c.PublishedAt = &published.String
	}
	c.Href = "/writing/" + c.Slug
	return c, err
}

func (s *Store) GetContentByID(id string, includeDrafts bool) (model.Content, error) {
	var c model.Content
	var tags, metadata, published sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version FROM content WHERE id = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, id).Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	c.Tags = decodeStrings(tags.String)
	c.Metadata = decodeMetadata(metadata.String)
	if published.Valid {
		c.PublishedAt = &published.String
	}
	c.Href = "/writing/" + c.Slug
	return c, err
}

func (s *Store) GetNow() (model.NowStatus, error) {
	var n model.NowStatus
	err := s.DB.QueryRow(`SELECT title, detail, mood, updated_at FROM now_status WHERE id = 'now_1'`).Scan(&n.Title, &n.Detail, &n.Mood, &n.UpdatedAt)
	return n, err
}

func (s *Store) Stats() (model.Stats, error) {
	var stats model.Stats
	err := s.DB.QueryRow(`SELECT COUNT(*), SUM(kind = 'TECH'), SUM(kind = 'THOUGHT'), SUM(kind = 'MANUSCRIPT'), COALESCE(SUM(length(body) - length(replace(body, ' ', '')) + 1), 0) FROM content WHERE status = 'PUBLISHED'`).Scan(&stats.ContentCount, &stats.TechCount, &stats.ThoughtCount, &stats.ManuscriptCount, &stats.WordCount)
	stats.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return stats, err
}

func (s *Store) ListComments(contentID, status string) ([]model.Comment, error) {
	query := `SELECT id, content_id, author_name, author_url, body, status, created_at, reply_to_id FROM comments WHERE content_id = ?`
	args := []any{contentID}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at ASC`
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []model.Comment
	for rows.Next() {
		var c model.Comment
		if err := rows.Scan(&c.ID, &c.ContentID, &c.AuthorName, &c.AuthorURL, &c.Body, &c.Status, &c.CreatedAt, &c.ReplyToID); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (s *Store) ListAllComments(status string) ([]model.Comment, error) {
	query := `SELECT id, content_id, author_name, author_url, body, status, created_at, reply_to_id FROM comments`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []model.Comment
	for rows.Next() {
		var c model.Comment
		if err := rows.Scan(&c.ID, &c.ContentID, &c.AuthorName, &c.AuthorURL, &c.Body, &c.Status, &c.CreatedAt, &c.ReplyToID); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (s *Store) CreateComment(contentID, authorName, authorURL, body string, replyToID *string) (model.Comment, error) {
	id := "comment_" + time.Now().UTC().Format("20060102150405.000000000")
	created := time.Now().UTC().Format(time.RFC3339)
	_, err := s.DB.Exec(`INSERT INTO comments (id, content_id, author_name, author_url, body, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, id, contentID, authorName, authorURL, body, replyToID, created)
	return model.Comment{ID: id, ContentID: contentID, AuthorName: authorName, AuthorURL: authorURL, Body: body, Status: "PENDING", CreatedAt: created, ReplyToID: replyToID}, err
}

func (s *Store) GetReactionSummary(contentID, visitorID string) (model.ReactionSummary, error) {
	var summary model.ReactionSummary
	var likeCount, favoriteCount, viewerLiked, viewerFavorited int
	err := s.DB.QueryRow(`
		SELECT COALESCE(SUM(kind = 'LIKE'), 0), COALESCE(SUM(kind = 'FAVORITE'), 0),
		EXISTS(SELECT 1 FROM reactions WHERE content_id = ? AND visitor_id = ? AND kind = 'LIKE'),
		EXISTS(SELECT 1 FROM reactions WHERE content_id = ? AND visitor_id = ? AND kind = 'FAVORITE')
		FROM reactions WHERE content_id = ?`, contentID, visitorID, contentID, visitorID, contentID).Scan(&likeCount, &favoriteCount, &viewerLiked, &viewerFavorited)
	if err != nil {
		return summary, err
	}
	summary.LikeCount = likeCount
	summary.FavoriteCount = favoriteCount
	summary.ViewerLiked = viewerLiked == 1
	summary.ViewerFavorited = viewerFavorited == 1
	return summary, nil
}

func (s *Store) SetReaction(contentID, visitorID, kind string) error {
	id := "reaction_" + contentID + "_" + visitorID + "_" + kind
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO reactions (id, content_id, visitor_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`, id, contentID, visitorID, kind, time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) DeleteReaction(contentID, visitorID, kind string) error {
	_, err := s.DB.Exec(`DELETE FROM reactions WHERE content_id = ? AND visitor_id = ? AND kind = ?`, contentID, visitorID, kind)
	return err
}

func (s *Store) SetCommentStatus(id, status string) error {
	result, err := s.DB.Exec(`UPDATE comments SET status = ? WHERE id = ?`, status, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) PendingCommentCount() (int, error) {
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM comments WHERE status = 'PENDING'`).Scan(&count)
	return count, err
}

func (s *Store) RecordAuditEvent(eventName, resourceType, resourceID, actor, requestID, traceID string, metadata map[string]string) error {
	if metadata == nil {
		metadata = map[string]string{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	id := "audit_" + time.Now().UTC().Format("20060102150405.000000000")
	_, err = s.DB.Exec(`INSERT INTO audit_events (id, event_name, resource_type, resource_id, actor, request_id, trace_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, eventName, resourceType, resourceID, actor, requestID, traceID, string(raw), time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) AuditEventCount() (int, error) {
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM audit_events`).Scan(&count)
	return count, err
}

func (s *Store) CreateContent(c model.Content) (model.Content, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	c.ID, c.Status, c.CreatedAt, c.UpdatedAt, c.Version = "content_"+time.Now().UTC().Format("20060102150405.000000000"), "DRAFT", now, now, 1
	_, err := s.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, c.ID, c.Kind, c.Status, c.Slug, c.Title, c.Summary, c.Body, encodeStrings(c.Tags), encodeJSON(c.Metadata), now, now)
	return c, err
}

func (s *Store) UpdateContent(id string, update ContentUpdate) error {
	sets := make([]string, 0, 4)
	args := make([]any, 0, 7)
	if update.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *update.Title)
	}
	if update.Summary != nil {
		sets = append(sets, "summary = ?")
		args = append(args, *update.Summary)
	}
	if update.Body != nil {
		sets = append(sets, "body = ?")
		args = append(args, *update.Body)
	}
	if update.Tags != nil {
		sets = append(sets, "tags_json = ?")
		args = append(args, encodeStrings(*update.Tags))
	}
	if update.Metadata != nil {
		sets = append(sets, "metadata_json = ?")
		args = append(args, encodeJSON(*update.Metadata))
	}
	sets = append(sets, "version = version + 1", "updated_at = ?")
	args = append(args, time.Now().UTC().Format(time.RFC3339), id, update.ExpectedVersion)
	result, err := s.DB.Exec(`UPDATE content SET `+strings.Join(sets, ", ")+` WHERE id = ? AND status != 'DELETED' AND version = ?`, args...)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM content WHERE id = ? AND status != 'DELETED'`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return ErrContentNotFound
	}
	return ErrVersionConflict
}

func (s *Store) SetContentStatus(id, status string) error {
	var published any
	if status == "PUBLISHED" {
		published = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := s.DB.Exec(`UPDATE content SET status = ?, published_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, status, published, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) DeleteContent(id string) error { return s.SetContentStatus(id, "DELETED") }

func (s *Store) UpdateNow(n model.NowStatus) error {
	_, err := s.DB.Exec(`UPDATE now_status SET title = ?, detail = ?, mood = ?, updated_at = ? WHERE id = 'now_1'`, n.Title, n.Detail, n.Mood, time.Now().UTC().Format(time.RFC3339))
	return err
}
