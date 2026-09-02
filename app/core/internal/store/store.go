package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"

	_ "modernc.org/sqlite"

	"github.com/manifold-space/manifold/app/core/db"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

const schemaVersion = 1

var (
	ErrContentNotFound     = errors.New("content not found")
	ErrVersionConflict     = errors.New("content version conflict")
	ErrSlugTaken           = errors.New("content slug already taken")
	ErrCommentReplyInvalid = errors.New("comment reply target is invalid")
	ErrSchemaTooNew        = errors.New("database schema is newer than this binary")
	ErrSchemaMismatch      = errors.New("database schema does not match this binary")
)

const presenceTTL = 5 * time.Minute

const contentExcerptMaxRunes = 360

var defaultSections = []string{"PROFILE", "BACKGROUND", "RECENT_CONTENT", "UPDATES", "SERIES", "CONTACT"}

var (
	markdownImagePattern               = regexp.MustCompile(`!\[[^\]]*\](?:\([^)]*\)|\[[^]]*\])`)
	markdownLinkPattern                = regexp.MustCompile(`\[([^\]]+)\](?:\([^)]*\)|\[[^]]*\])`)
	markdownAutolinkPattern            = regexp.MustCompile(`<((?:https?://|mailto:)[^>]+)>`)
	markdownHTMLPattern                = regexp.MustCompile(`</?[A-Za-z][^>]*>`)
	markdownCommentPattern             = regexp.MustCompile(`<!--.*?-->`)
	markdownStrongPattern              = regexp.MustCompile(`(?:\*\*|__)(\S(?:.*?\S)?)(?:\*\*|__)`)
	markdownStrikePattern              = regexp.MustCompile(`~~(\S(?:.*?\S)?)~~`)
	markdownCodePattern                = regexp.MustCompile("`([^`]+)`")
	markdownEscapePattern              = regexp.MustCompile(`\\([\\` + "`" + `*_[\]{}()#+.!<>~-])`)
	markdownReferenceDefinitionPattern = regexp.MustCompile(`^\[[^\]]+\]:\s*\S+`)
	markdownSpacePattern               = regexp.MustCompile(`\s+`)
	markdownExcerptHeadingPattern      = regexp.MustCompile(`^#{1,6}\s+`)
	markdownQuotePattern               = regexp.MustCompile(`^>\s?`)
	markdownListPattern                = regexp.MustCompile(`^(?:[-+*]|\d+[.)])\s+`)
)

func contentExcerpt(body string) string {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	parts := make([]string, 0, len(lines))
	inFence := false
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if strings.HasPrefix(text, "```") || strings.HasPrefix(text, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence || text == "" || markdownReferenceDefinitionPattern.MatchString(text) {
			continue
		}
		text = markdownExcerptHeadingPattern.ReplaceAllString(text, "")
		text = markdownQuotePattern.ReplaceAllString(text, "")
		text = markdownListPattern.ReplaceAllString(text, "")
		text = markdownImagePattern.ReplaceAllString(text, "")
		text = markdownLinkPattern.ReplaceAllString(text, "$1")
		text = markdownAutolinkPattern.ReplaceAllString(text, "$1")
		text = markdownCommentPattern.ReplaceAllString(text, "")
		text = markdownHTMLPattern.ReplaceAllString(text, "")
		text = markdownStrongPattern.ReplaceAllString(text, "$1")
		text = markdownStrikePattern.ReplaceAllString(text, "$1")
		text = markdownCodePattern.ReplaceAllString(text, "$1")
		text = markdownEscapePattern.ReplaceAllString(text, "$1")
		text = markdownSpacePattern.ReplaceAllString(strings.TrimSpace(text), " ")
		if text != "" {
			parts = append(parts, text)
		}
	}
	excerpt := strings.TrimSpace(strings.Join(parts, " "))
	runes := []rune(excerpt)
	if len(runes) > contentExcerptMaxRunes {
		return strings.TrimSpace(string(runes[:contentExcerptMaxRunes]))
	}
	return excerpt
}

type Store struct{ DB *sql.DB }

type ContentListOptions struct {
	Kinds      []model.ContentKind
	Status     model.ContentStatus
	Tags       []string
	Query      string
	AiAssisted *bool
	Sort       string
	Page       int
	PageSize   int
}

type ContentListResult struct {
	Items      []model.Content
	Page       int
	PageSize   int
	TotalItems int
	TotalPages int
}

type ContentUpdate struct {
	Kind            *model.ContentKind
	Slug            *string
	Title           *string
	TitleSet        bool
	Summary         *string
	Body            *string
	Tags            *[]string
	Metadata        json.RawMessage
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
	// SQLite is safest as a single-writer connection for this workload; it
	// also makes transactions trivially serializable without busy retries.
	db.SetMaxOpenConns(1)
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.seed(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// migrate applies every embedded migration below the schema's known version.
// A database from a newer binary refuses to open rather than being silently
// downgraded.
func (s *Store) migrate() error {
	if _, err := s.DB.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return err
	}
	var userVersion int
	if err := s.DB.QueryRow(`PRAGMA user_version`).Scan(&userVersion); err != nil {
		return err
	}
	var existingTables int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations'`).Scan(&existingTables); err != nil {
		return err
	}
	if existingTables > 0 && userVersion != schemaVersion {
		return fmt.Errorf("%w: expected %d, found %d; delete the local database and recreate it", ErrSchemaMismatch, schemaVersion, userVersion)
	}
	if _, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		return err
	}
	var current int
	if err := s.DB.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}
	if current > schemaVersion {
		return fmt.Errorf("%w: database at %d, binary knows %d", ErrSchemaTooNew, current, schemaVersion)
	}
	for version := current + 1; version <= schemaVersion; version++ {
		script, err := fs.ReadFile(db.MigrationsFS, fmt.Sprintf("migrations/%04d_init.sql", version))
		if err != nil {
			return fmt.Errorf("read migration %d: %w", version, err)
		}
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(script)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	if _, err := s.DB.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		return err
	}
	return nil
}

func (s *Store) seed() error {
	var seeded int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM content`).Scan(&seeded); err != nil {
		return err
	}
	if seeded > 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO profile (id, display_name, handle, headline, bio, location, avatar_url, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at) VALUES ('profile_1', 'Manifold', '@manifold', 'Profile, writings, and thoughts.', 'Technical writings and short thoughts.', 'Peking, China', '', 'Independent', 'https://manifold.local', '', '["systems","research","writing"]', '[{"institution":"Independent","program":"Research and engineering","period":"Now"}]', '[{"organization":"Manifold","role":"Research and software","period":"Now"}]', '[{"name":"API relay","url":"https://api.weizixiang.dev","description":"A small public gateway for experiments and personal infrastructure.","category":"Infrastructure"},{"name":"OpenList","url":"https://openlist.weizixiang.dev","description":"A calm index for files, links, and things worth keeping close.","category":"Tool"}]', '[{"label":"GitHub","url":"https://github.com/manifold-space/manifold","handle":"@manifold-space"},{"label":"Email","url":"mailto:hello@manifold.local","handle":"hello@manifold.local"}]', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO site_config (id, navigation_json, sections_json, updated_at) VALUES ('site_1', ?, ?, ?)`, encodeJSON([]model.SiteNavigationItem{{Label: "Home", Href: "/"}, {Label: "Writings", Href: "/writing"}, {Label: "Thoughts", Href: "/thoughts"}}), encodeJSON(defaultSections), now); err != nil {
		return err
	}
	seedContent := []struct {
		id, kind, slug, title, summary, body, tags, metadata string
	}{
		{"content_1", "ARTICLE", "designing-boundaries", "Designing Boundaries", "Notes on designing boundaries in personal systems.", "# Designing Boundaries\n\nA personal system should preserve attention and make the next action clear.\n\n## The boundary\n\nSmall interfaces reduce unnecessary decisions.", `["systems","design"]`, `{"language":"Go","aiAssisted":false}`},
		{"content_2", "THOUGHT", "a-small-signal", "A Small Signal", "Short note on when to turn an observation into a system.", "Not every observation needs a system. First decide whether it changes the way you work.", `["thinking"]`, `{"mood":"Curious","question":"When is a system justified?"}`},
		{"content_3", "ARTICLE", "reading-the-edge", "Reading the Edge", "Questions about the relationship between software and daily life.", "## Open question\n\nHow do small tools change the way we notice the world?", `["systems"]`, `{}`},
	}
	for _, item := range seedContent {
		kind := model.ContentKind(item.kind)
		metadata, err := model.NormalizeMetadataFor(kind, item.body, json.RawMessage(item.metadata))
		if err != nil {
			return err
		}
		excerpt := contentExcerpt(item.body)
		var title any
		if item.title != "" {
			title = item.title
		}
		if _, err := s.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, excerpt, metadata_json, published_at, created_at, updated_at) VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.id, kind, item.slug, title, item.summary, item.body, excerpt, encodeJSON(metadata), now, now, now); err != nil {
			return err
		}
		for _, tag := range decodeTags(item.tags) {
			if _, err := s.DB.Exec(`INSERT INTO content_tags (content_id, tag) VALUES (?, ?)`, item.id, tag); err != nil {
				return err
			}
		}
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO thoughts_config (id, featured_thought_id, updated_at) VALUES ('thoughts_1', NULL, ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO writings_config (id, featured_writing_id, updated_at) VALUES ('writings_1', NULL, ?)`, now); err != nil {
		return err
	}
	return nil
}

func encodeJSON(value any) string {
	raw, err := json.Marshal(value)
	if err == nil {
		return string(raw)
	}
	return "[]"
}

func decodeTags(raw string) []string {
	var tags []string
	_ = json.Unmarshal([]byte(raw), &tags)
	if tags == nil {
		return []string{}
	}
	return tags
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func newID(prefix string) string {
	return prefix + "_" + time.Now().UTC().Format("20060102150405.000000000")
}

func countWords(body string) int {
	latinWords, cjkCharacters := 0, 0
	inWord := false
	for _, r := range body {
		if isCJK(r) {
			cjkCharacters++
			inWord = false
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if !inWord {
				latinWords++
				inWord = true
			}
			continue
		}
		inWord = false
	}
	return latinWords + cjkCharacters
}

func isCJK(r rune) bool {
	return (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x3040 && r <= 0x30ff) || (r >= 0xac00 && r <= 0xd7af)
}
