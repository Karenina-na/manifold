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
CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '', resume_url TEXT NOT NULL DEFAULT '', interests_json TEXT NOT NULL DEFAULT '[]', education_json TEXT NOT NULL DEFAULT '[]', experience_json TEXT NOT NULL DEFAULT '[]', series_json TEXT NOT NULL DEFAULT '[]', contacts_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('THOUGHT', 'ARTICLE')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DELETED')), slug TEXT UNIQUE, title TEXT, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, view_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS now_status (id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'FOCUSED', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_config (id TEXT PRIMARY KEY, featured_content_json TEXT NOT NULL DEFAULT '[]', navigation_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id), author_name TEXT NOT NULL, author_url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')), reply_to_id TEXT REFERENCES comments(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE, visitor_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('LIKE', 'FAVORITE')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (content_id, visitor_id, kind));
CREATE TABLE IF NOT EXISTS presence (visitor_id TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'anonymous', request_id TEXT NOT NULL DEFAULT '', trace_id TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_content_publication ON content(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_content_status ON comments(content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_content_kind ON reactions(content_id, kind);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_content_views ON audit_events(event_name, resource_id);
`

type Store struct{ DB *sql.DB }

const presenceTTL = 5 * time.Minute

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
	Kind            *model.ContentKind
	Slug            *string
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
	if err := ensureProfileColumns(db); err != nil {
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
	hasMetadata, hasViewCount := false, false
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
		if name == "view_count" {
			hasViewCount = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var tableSQL string
	if err := db.QueryRow(`SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = 'content'`).Scan(&tableSQL); err != nil {
		return err
	}
	if strings.Contains(tableSQL, "'POST'") || strings.Contains(tableSQL, "'NOTE'") || strings.Contains(tableSQL, "'RESEARCH'") || strings.Contains(tableSQL, "'TECH'") || strings.Contains(tableSQL, "'MANUSCRIPT'") {
		if err := migrateLegacyContent(db, hasMetadata, hasViewCount); err != nil {
			return err
		}
		return backfillArticleMetadata(db)
	}
	if !hasMetadata {
		if _, err = db.Exec(`ALTER TABLE content ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`); err != nil {
			return err
		}
	}
	if !hasViewCount {
		if _, err = db.Exec(`ALTER TABLE content ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
	}
	_, err = db.Exec(`UPDATE content SET metadata_json = CASE WHEN kind = 'THOUGHT' THEN '{}' ELSE metadata_json END WHERE TRIM(metadata_json) = '' OR metadata_json = '{}'`)
	if err != nil {
		return err
	}
	return backfillArticleMetadata(db)
}

func backfillArticleMetadata(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, body, metadata_json FROM content WHERE kind = 'ARTICLE'`)
	if err != nil {
		return err
	}
	type articleRow struct {
		id, body, metadata string
	}
	articles := make([]articleRow, 0)
	for rows.Next() {
		var article articleRow
		if err := rows.Scan(&article.id, &article.body, &article.metadata); err != nil {
			_ = rows.Close()
			return err
		}
		articles = append(articles, article)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, article := range articles {
		encoded := encodeJSON(normalizeArticleMetadata("ARTICLE", article.body, decodeMetadata(article.metadata)))
		if encoded == article.metadata {
			continue
		}
		if _, err := db.Exec(`UPDATE content SET metadata_json = ? WHERE id = ?`, encoded, article.id); err != nil {
			return err
		}
	}
	return nil
}

func migrateLegacyContent(db *sql.DB, hasMetadata, hasViewCount bool) error {
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
	contentTable := `CREATE TABLE content_new (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('THOUGHT', 'ARTICLE')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DELETED')), slug TEXT UNIQUE, title TEXT, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, view_count INTEGER NOT NULL DEFAULT 0)`
	if _, err = tx.Exec(contentTable); err != nil {
		_ = tx.Rollback()
		return rollback(err)
	}
	metadataExpression := `CASE kind WHEN 'POST' THEN '{}' WHEN 'NOTE' THEN '{}' WHEN 'RESEARCH' THEN '{}' WHEN 'TECH' THEN '{"technologies":["Unspecified"]}' WHEN 'MANUSCRIPT' THEN '{"form":"OTHER","stage":"DRAFT"}' ELSE '{}' END`
	if hasMetadata {
		metadataExpression = `CASE kind WHEN 'POST' THEN '{}' WHEN 'NOTE' THEN '{}' WHEN 'RESEARCH' THEN '{}' WHEN 'TECH' THEN '{"technologies":["Unspecified"]}' WHEN 'MANUSCRIPT' THEN '{"form":"OTHER","stage":"DRAFT"}' ELSE CASE WHEN TRIM(metadata_json) = '' THEN '{}' ELSE metadata_json END END`
	}
	viewCountExpression := "0"
	if hasViewCount {
		viewCountExpression = "view_count"
	}
	query := `INSERT INTO content_new (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, version, updated_at, view_count) SELECT id, CASE kind WHEN 'POST' THEN 'ARTICLE' WHEN 'NOTE' THEN 'THOUGHT' WHEN 'RESEARCH' THEN 'ARTICLE' WHEN 'TECH' THEN 'ARTICLE' WHEN 'MANUSCRIPT' THEN 'ARTICLE' ELSE kind END, status, slug, title, summary, body, tags_json, ` + metadataExpression + `, published_at, created_at, version, updated_at, ` + viewCountExpression + ` FROM content`
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
	_, err = db.Exec(`UPDATE site_config SET navigation_json = ?, sections_json = ? WHERE id = 'site_1' AND (navigation_json LIKE '%TECH%' OR navigation_json LIKE '%MANUSCRIPT%' OR sections_json LIKE '%MANUSCRIPT%')`, encodeJSON([]model.SiteNavigationItem{{Label: "Thoughts", Href: "/thoughts"}, {Label: "Writings", Href: "/writing"}}), encodeJSON([]string{"PROFILE", "CV", "RECENT_ACTIVITY"}))
	if err != nil {
		return err
	}
	return nil
}

func ensureProfileColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(profile)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, column := range []string{"resume_url", "interests_json", "education_json", "experience_json", "series_json", "contacts_json"} {
		if !columns[column] {
			defaultValue := "'[]'"
			if column == "resume_url" {
				defaultValue = "''"
			}
			if _, err := db.Exec(`ALTER TABLE profile ADD COLUMN ` + column + ` TEXT NOT NULL DEFAULT ` + defaultValue); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) seed() error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO profile (id, display_name, handle, headline, bio, location, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at) VALUES ('profile_1', 'Manifold', '@manifold', 'Profile, writings, and thoughts.', 'Technical writings and short thoughts.', 'Peking, China', 'Independent', 'https://manifold.local', '', '["systems","research","writing"]', '[{"institution":"Independent","program":"Research and engineering","period":"Now"}]', '[{"organization":"Manifold","role":"Research and software","period":"Now"}]', '[{"name":"API relay","url":"https://api.weizixiang.dev","description":"A small public gateway for experiments and personal infrastructure.","category":"Infrastructure"},{"name":"OpenList","url":"https://openlist.weizixiang.dev","description":"A calm index for files, links, and things worth keeping close.","category":"Tool"}]', '[{"label":"GitHub","url":"https://github.com/manifold-space/manifold","handle":"@manifold-space"},{"label":"Email","url":"mailto:hello@manifold.local","handle":"hello@manifold.local"}]', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE profile SET series_json = '[{"name":"API relay","url":"https://api.weizixiang.dev","description":"A small public gateway for experiments and personal infrastructure.","category":"Infrastructure"},{"name":"OpenList","url":"https://openlist.weizixiang.dev","description":"A calm index for files, links, and things worth keeping close.","category":"Tool"}]' WHERE id = 'profile_1' AND series_json = '[]'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE profile SET contacts_json = '[{"label":"GitHub","url":"https://github.com/manifold-space/manifold","handle":"@manifold-space"},{"label":"Email","url":"mailto:hello@manifold.local","handle":"hello@manifold.local"}]' WHERE id = 'profile_1' AND contacts_json = '[]'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE profile SET headline = 'Profile, writings, and thoughts.', bio = 'Technical writings and short thoughts.' WHERE id = 'profile_1' AND headline = 'A living digital garden for ideas in motion.'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE profile SET bio = 'Technical writings and short thoughts.' WHERE id = 'profile_1' AND bio = 'Technical writings and short thoughtsxxxxx'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE now_status SET title = 'Balancing current work', detail = 'Current work across software and research.' WHERE id = 'now_1' AND title = 'Building the first garden'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE content SET summary = 'Notes on designing boundaries in personal systems.' WHERE id = 'content_1' AND summary = 'A field note on keeping a personal system calm and extensible.'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE content SET summary = 'Short note on when to turn an observation into a system.', body = 'Not every observation needs a system. First decide whether it changes the way you work.' WHERE id = 'content_2' AND summary = 'Not every thought needs to become a system. Some only need a place to land.'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE content SET summary = 'Questions about the relationship between software and daily life.' WHERE id = 'content_3' AND summary = 'A research notebook for questions that sit between engineering and lived experience.'`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO now_status (id, title, detail, mood, updated_at) VALUES ('now_1', 'Balancing current work', 'Current work across software and research.', 'FOCUSED', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO site_config (id, featured_content_json, navigation_json, sections_json, updated_at) VALUES ('site_1', ?, ?, ?, ?)`, encodeJSON([]model.SiteContentRef{{ID: "content_1", Kind: model.ContentKindArticle}}), encodeJSON([]model.SiteNavigationItem{{Label: "Thoughts", Href: "/thoughts"}, {Label: "Writings", Href: "/writing"}}), encodeJSON([]string{"PROFILE", "CV", "RECENT_ACTIVITY"}), now); err != nil {
		return err
	}
	seedContent := []struct {
		id, kind, slug, title, summary, body, tags, metadata string
	}{
		{"content_1", "ARTICLE", "designing-boundaries", "Designing Boundaries", "Notes on designing boundaries in personal systems.", "# Designing Boundaries\n\nA personal system should preserve attention and make the next action clear.\n\n## The boundary\n\nSmall interfaces reduce unnecessary decisions.", `["systems","design"]`, `{"technologies":["Go","SQLite","Next.js"],"language":"Go","difficulty":"INTERMEDIATE","readingMinutes":6,"toc":[{"id":"the-boundary","label":"The boundary","level":2}]}`},
		{"content_2", "THOUGHT", "a-small-signal", "A Small Signal", "Short note on when to turn an observation into a system.", "Not every observation needs a system. First decide whether it changes the way you work.", `["thinking"]`, `{"mood":"Curious","question":"When is a system justified?"}`},
		{"content_3", "ARTICLE", "reading-the-edge", "Reading the Edge", "Questions about the relationship between software and daily life.", "## Open question\n\nHow do small tools change the way we notice the world?", `["systems"]`, `{"readingMinutes":3,"toc":[{"id":"open-question","label":"Open question","level":2}]}`},
	}
	for _, item := range seedContent {
		if _, err := s.DB.Exec(`INSERT OR IGNORE INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES (?, ?, 'PUBLISHED', NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`, item.id, item.kind, item.slug, item.title, item.summary, item.body, item.tags, item.metadata, now, now, now); err != nil {
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
	var interests, education, experience, series, contacts string
	err := s.DB.QueryRow(`SELECT id, display_name, handle, headline, bio, avatar_url, location, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at FROM profile WHERE id = 'profile_1'`).Scan(&p.ID, &p.DisplayName, &p.Handle, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Organization, &p.WebsiteURL, &p.ResumeURL, &interests, &education, &experience, &series, &contacts, &p.UpdatedAt)
	_ = json.Unmarshal([]byte(interests), &p.Interests)
	_ = json.Unmarshal([]byte(education), &p.Education)
	_ = json.Unmarshal([]byte(experience), &p.Experience)
	_ = json.Unmarshal([]byte(series), &p.Series)
	_ = json.Unmarshal([]byte(contacts), &p.Contacts)
	return p, err
}

func (s *Store) UpdateProfile(p model.Profile) error {
	_, err := s.DB.Exec(`UPDATE profile SET display_name = ?, handle = ?, headline = ?, bio = ?, avatar_url = ?, location = ?, organization = ?, website_url = ?, resume_url = ?, interests_json = ?, education_json = ?, experience_json = ?, series_json = ?, contacts_json = ?, updated_at = ? WHERE id = 'profile_1'`, p.DisplayName, p.Handle, p.Headline, p.Bio, p.AvatarURL, p.Location, p.Organization, p.WebsiteURL, p.ResumeURL, encodeJSON(p.Interests), encodeJSON(p.Education), encodeJSON(p.Experience), encodeJSON(p.Series), encodeJSON(p.Contacts), time.Now().UTC().Format(time.RFC3339))
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
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version, view_count, (SELECT COUNT(*) FROM reactions WHERE content_id = content.id AND kind = 'LIKE') FROM content WHERE 1 = 1`
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
		var tags, metadata, published, slug, title sql.NullString
		if err := rows.Scan(&c.ID, &c.Kind, &c.Status, &slug, &title, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version, &c.ViewCount, &c.LikeCount); err != nil {
			return nil, false, err
		}
		c.Slug, c.Title = slug.String, title.String
		c.Tags = decodeStrings(tags.String)
		c.Metadata = decodeMetadata(metadata.String)
		if published.Valid {
			c.PublishedAt = &published.String
		}
		if c.Kind == model.ContentKindThought {
			c.Href = "/thoughts/" + c.ID
		} else {
			c.Href = "/writing/" + c.Slug
		}
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
	var tags, metadata, published, slugValue, titleValue sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version, view_count, (SELECT COUNT(*) FROM reactions WHERE content_id = content.id AND kind = 'LIKE') FROM content WHERE (slug = ? OR id = ?) AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, slug, slug).Scan(&c.ID, &c.Kind, &c.Status, &slugValue, &titleValue, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version, &c.ViewCount, &c.LikeCount)
	c.Slug, c.Title = slugValue.String, titleValue.String
	c.Tags = decodeStrings(tags.String)
	c.Metadata = decodeMetadata(metadata.String)
	if published.Valid {
		c.PublishedAt = &published.String
	}
	if c.Kind == model.ContentKindThought {
		c.Href = "/thoughts/" + c.ID
	} else {
		c.Href = "/writing/" + c.Slug
	}
	return c, err
}

func (s *Store) GetContentByID(id string, includeDrafts bool) (model.Content, error) {
	var c model.Content
	var tags, metadata, published, slug, title sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at, version, view_count, (SELECT COUNT(*) FROM reactions WHERE content_id = content.id AND kind = 'LIKE') FROM content WHERE id = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, id).Scan(&c.ID, &c.Kind, &c.Status, &slug, &title, &c.Summary, &c.Body, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version, &c.ViewCount, &c.LikeCount)
	c.Slug, c.Title = slug.String, title.String
	c.Tags = decodeStrings(tags.String)
	c.Metadata = decodeMetadata(metadata.String)
	if published.Valid {
		c.PublishedAt = &published.String
	}
	if c.Kind == model.ContentKindThought {
		c.Href = "/thoughts/" + c.ID
	} else {
		c.Href = "/writing/" + c.Slug
	}
	return c, err
}

func (s *Store) GetNow() (model.NowStatus, error) {
	var n model.NowStatus
	err := s.DB.QueryRow(`SELECT title, detail, mood, updated_at FROM now_status WHERE id = 'now_1'`).Scan(&n.Title, &n.Detail, &n.Mood, &n.UpdatedAt)
	return n, err
}

func (s *Store) Stats() (model.Stats, error) {
	var stats model.Stats
	err := s.DB.QueryRow(`SELECT COUNT(*), SUM(kind = 'ARTICLE'), SUM(kind = 'THOUGHT'), COALESCE(SUM(length(body) - length(replace(body, ' ', '')) + 1), 0) FROM content WHERE status = 'PUBLISHED'`).Scan(&stats.ContentCount, &stats.ArticleCount, &stats.ThoughtCount, &stats.WordCount)
	stats.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return stats, err
}

func (s *Store) TouchPresence(visitorID string) (int, error) {
	now := time.Now().UTC()
	cutoff := now.Add(-presenceTTL).Format(time.RFC3339)
	if _, err := s.DB.Exec(`DELETE FROM presence WHERE last_seen_at < ?`, cutoff); err != nil {
		return 0, err
	}
	if _, err := s.DB.Exec(`INSERT INTO presence (visitor_id, last_seen_at) VALUES (?, ?) ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`, visitorID, now.Format(time.RFC3339)); err != nil {
		return 0, err
	}
	var activeVisitors int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM presence WHERE last_seen_at >= ?`, cutoff).Scan(&activeVisitors); err != nil {
		return 0, err
	}
	return activeVisitors, nil
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

func (s *Store) RecordContentView(contentID string) (int, int, error) {
	if _, err := s.DB.Exec(`UPDATE content SET view_count = view_count + 1 WHERE id = ?`, contentID); err != nil {
		return 0, 0, err
	}
	var viewCount, likeCount int
	if err := s.DB.QueryRow(`SELECT view_count, (SELECT COUNT(*) FROM reactions WHERE content_id = content.id AND kind = 'LIKE') FROM content WHERE id = ?`, contentID).Scan(&viewCount, &likeCount); err != nil {
		return 0, 0, err
	}
	return viewCount, likeCount, nil
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
	c.Metadata = normalizeArticleMetadata(string(c.Kind), c.Body, c.Metadata)
	_, err := s.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?)`, c.ID, c.Kind, c.Status, c.Slug, c.Title, c.Summary, c.Body, encodeStrings(c.Tags), encodeJSON(c.Metadata), now, now)
	return c, err
}

func (s *Store) UpdateContent(id string, update ContentUpdate) error {
	if update.Body != nil || update.Metadata != nil || update.Kind != nil {
		current, err := s.GetContentByID(id, true)
		if err != nil {
			return err
		}
		effectiveKind := current.Kind
		if update.Kind != nil {
			effectiveKind = *update.Kind
		}
		effectiveBody := current.Body
		if update.Body != nil {
			effectiveBody = *update.Body
		}
		effectiveMetadata := current.Metadata
		if update.Metadata != nil {
			effectiveMetadata = *update.Metadata
		}
		if effectiveKind == model.ContentKindArticle {
			normalized := normalizeArticleMetadata(string(effectiveKind), effectiveBody, effectiveMetadata)
			update.Metadata = &normalized
		}
	}
	sets := make([]string, 0, 4)
	args := make([]any, 0, 7)
	if update.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *update.Title)
	}
	if update.Slug != nil {
		sets = append(sets, "slug = NULLIF(?, '')")
		args = append(args, *update.Slug)
	}
	if update.Kind != nil {
		sets = append(sets, "kind = ?")
		args = append(args, *update.Kind)
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
