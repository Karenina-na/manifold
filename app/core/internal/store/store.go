package store

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const schema = `
CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('POST', 'NOTE', 'RESEARCH')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DELETED')), slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS now_status (id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'FOCUSED', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE', featured INTEGER NOT NULL DEFAULT 0, homepage_url TEXT NOT NULL DEFAULT '', repository_url TEXT NOT NULL DEFAULT '', tech_stack_json TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content(id), author_name TEXT NOT NULL, author_url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')), reply_to_id TEXT REFERENCES comments(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_content_publication ON content(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_content_status ON comments(content_id, status, created_at);
`

type Store struct{ DB *sql.DB }

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
	s := &Store{DB: db}
	if err := s.seed(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) seed() error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO profile (id, display_name, handle, headline, bio, location, organization, website_url, updated_at) VALUES ('profile_1', 'Manifold', '@manifold', 'A living digital garden for ideas in motion.', 'A quiet space for experiences, writing, thoughts, and research.', 'Peking, China', 'Independent', 'https://manifold.local', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO now_status (id, title, detail, mood, updated_at) VALUES ('now_1', 'Building the first garden', 'Shaping a small API-first space for ideas, projects, and research notes.', 'FOCUSED', ?)`, now); err != nil {
		return err
	}
	seedContent := []struct {
		id, kind, slug, title, summary, body, tags string
	}{
		{"content_1", "POST", "designing-boundaries", "Designing Boundaries", "A field note on keeping a personal system calm and extensible.", "# Designing Boundaries\n\nA good personal system leaves room for the next thought without making today harder.", `["systems","design"]`},
		{"content_2", "NOTE", "a-small-signal", "A Small Signal", "Not every thought needs to become a system. Some only need a place to land.", "Not every thought needs to become a system. Some only need a place to land.", `["notes"]`},
		{"content_3", "RESEARCH", "reading-the-edge", "Reading the Edge", "A research notebook for questions that sit between engineering and lived experience.", "## Open question\n\nHow do small tools change the way we notice the world?", `["research","systems"]`},
	}
	for _, item := range seedContent {
		if _, err := s.DB.Exec(`INSERT OR IGNORE INTO content (id, kind, status, slug, title, summary, body, tags_json, published_at, created_at, updated_at) VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?)`, item.id, item.kind, item.slug, item.title, item.summary, item.body, item.tags, now, now, now); err != nil {
			return err
		}
	}
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO projects (id, slug, name, summary, description, status, featured, homepage_url, repository_url, tech_stack_json, started_at, updated_at) VALUES ('project_1', 'manifold', 'Manifold', 'This personal digital garden.', 'An API-first home for writing, thoughts, and research.', 'ACTIVE', 1, 'https://manifold.local', 'https://github.com/manifold-space/manifold', '["Go","Next.js","SQLite"]', '2026-08', ?)`, now)
	return err
}

func decodeStrings(raw string) []string {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}

func encodeStrings(values []string) string {
	raw, _ := json.Marshal(values)
	return string(raw)
}

func (s *Store) GetProfile() (model.Profile, error) {
	var p model.Profile
	err := s.DB.QueryRow(`SELECT id, display_name, handle, headline, bio, avatar_url, location, organization, website_url, updated_at FROM profile WHERE id = 'profile_1'`).Scan(&p.ID, &p.DisplayName, &p.Handle, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Organization, &p.WebsiteURL, &p.UpdatedAt)
	return p, err
}

func (s *Store) ListContent(includeDrafts bool) ([]model.Content, error) {
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, published_at, created_at, updated_at, version FROM content WHERE status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	query += ` ORDER BY COALESCE(published_at, created_at) DESC`
	rows, err := s.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []model.Content
	for rows.Next() {
		var c model.Content
		var tags, published sql.NullString
		if err := rows.Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version); err != nil {
			return nil, err
		}
		c.Tags = decodeStrings(tags.String)
		if published.Valid {
			c.PublishedAt = &published.String
		}
		c.Href = "/writing/" + c.Slug
		if !includeDrafts {
			c.Body = ""
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (s *Store) GetContent(slug string, includeDrafts bool) (model.Content, error) {
	var c model.Content
	var tags, published sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, published_at, created_at, updated_at, version FROM content WHERE slug = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, slug).Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	c.Tags = decodeStrings(tags.String)
	if published.Valid {
		c.PublishedAt = &published.String
	}
	c.Href = "/writing/" + c.Slug
	return c, err
}

func (s *Store) GetContentByID(id string, includeDrafts bool) (model.Content, error) {
	var c model.Content
	var tags, published sql.NullString
	query := `SELECT id, kind, status, slug, title, summary, body, tags_json, published_at, created_at, updated_at, version FROM content WHERE id = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	err := s.DB.QueryRow(query, id).Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &c.Title, &c.Summary, &c.Body, &tags, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	c.Tags = decodeStrings(tags.String)
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

func (s *Store) ListProjects() ([]model.Project, error) {
	rows, err := s.DB.Query(`SELECT id, slug, name, summary, description, status, featured, homepage_url, repository_url, tech_stack_json, started_at, updated_at FROM projects ORDER BY featured DESC, started_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []model.Project
	for rows.Next() {
		var p model.Project
		var featured int
		var stack string
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.Summary, &p.Description, &p.Status, &featured, &p.HomepageURL, &p.RepositoryURL, &stack, &p.StartedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Featured = featured == 1
		p.TechStack = decodeStrings(stack)
		items = append(items, p)
	}
	return items, rows.Err()
}

func (s *Store) Stats() (model.Stats, error) {
	var stats model.Stats
	err := s.DB.QueryRow(`SELECT COUNT(*), SUM(kind = 'POST'), SUM(kind = 'NOTE'), SUM(kind = 'RESEARCH'), COALESCE(SUM(length(body) - length(replace(body, ' ', '')) + 1), 0) FROM content WHERE status = 'PUBLISHED'`).Scan(&stats.ContentCount, &stats.PostCount, &stats.NoteCount, &stats.ResearchCount, &stats.WordCount)
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

func (s *Store) CreateContent(c model.Content) (model.Content, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	c.ID, c.Status, c.CreatedAt, c.UpdatedAt, c.Version = "content_"+now, "DRAFT", now, now, 1
	_, err := s.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, c.ID, c.Kind, c.Status, c.Slug, c.Title, c.Summary, c.Body, encodeStrings(c.Tags), now, now)
	return c, err
}

func (s *Store) UpdateContent(id string, c model.Content) error {
	_, err := s.DB.Exec(`UPDATE content SET title = ?, summary = ?, body = ?, tags_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND status != 'DELETED'`, c.Title, c.Summary, c.Body, encodeStrings(c.Tags), time.Now().UTC().Format(time.RFC3339), id)
	return err
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
