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
	"github.com/manifold-space/manifold/app/core/internal/seed"
)

const schemaVersion = 2

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

var defaultNavigation = []model.SiteNavigationItem{{Label: "Home", Href: "/"}, {Label: "Writings", Href: "/writing"}, {Label: "Thoughts", Href: "/thoughts"}}

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

func Open(path string, options ...Option) (*Store, error) {
	oo := openOptions{}
	for _, apply := range options {
		apply(&oo)
	}
	plan, err := seedPlanFor(options)
	if err != nil {
		return nil, err
	}
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
	if err := s.applySeed(plan); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.ensureAdminCredential(oo.adminUsername, oo.adminPasswordHash); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// openOptions collects the optional behaviors of Open.
type openOptions struct {
	seedPlan          seed.Plan
	hasSeedPlan       bool
	adminUsername     string
	adminPasswordHash string
}

// Option customizes how a database is opened.
type Option func(*openOptions)

// WithSeedPlan supplies the data applied when the database is fresh. The
// production wiring passes the bootstrap plan; without an option a fresh
// database receives the built-in development seed.
func WithSeedPlan(plan seed.Plan) Option {
	return func(options *openOptions) {
		options.seedPlan = plan
		options.hasSeedPlan = true
	}
}

// WithAdminCredential supplies the bootstrap credential for a fresh database.
// The env value seeds the admin_credentials table once; afterwards the row is
// authoritative and the env value is ignored.
func WithAdminCredential(username, passwordHash string) Option {
	return func(options *openOptions) {
		options.adminUsername = username
		options.adminPasswordHash = passwordHash
	}
}

func seedPlanFor(options []Option) (seed.Plan, error) {
	resolved := openOptions{}
	for _, apply := range options {
		apply(&resolved)
	}
	if resolved.hasSeedPlan {
		return resolved.seedPlan, nil
	}
	plan, err := seed.Dev()
	if err != nil {
		return seed.Plan{}, fmt.Errorf("built-in dev seed: %w", err)
	}
	return plan, nil
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
	if existingTables > 0 && userVersion > schemaVersion {
		return fmt.Errorf("%w: database at %d, binary knows %d; upgrade the Core binary", ErrSchemaMismatch, userVersion, schemaVersion)
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

// applySeed populates a fresh database from the plan resolved at Open time.
// The gate counts profile rows instead of content rows so an admin who deletes
// every seeded article does not resurrect starter data on restart.
func (s *Store) applySeed(plan seed.Plan) error {
	var seeded int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM profile`).Scan(&seeded); err != nil {
		return err
	}
	if seeded > 0 {
		return nil
	}
	now := nowRFC3339()
	profile := plan.Profile
	if _, err := s.DB.Exec(`INSERT INTO profile (id, display_name, handle, headline, bio, location, avatar_url, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at) VALUES ('profile_1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		profile.DisplayName, profile.Handle, profile.Headline, profile.Bio, profile.Location, profile.AvatarURL, profile.Organization, profile.WebsiteURL, profile.ResumeURL,
		encodeJSON(profile.Interests), encodeJSON(profile.Education), encodeJSON(profile.Experience), encodeJSON(profile.Series), encodeJSON(profile.Contacts), now); err != nil {
		return err
	}
	if err := s.seedSiteConfig(plan.SiteConfig, now); err != nil {
		return err
	}
	for index, item := range plan.Contents {
		if err := s.seedContent(item, index, now); err != nil {
			return err
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

// seedSiteConfig inserts the site_config singleton. Site identity fields are
// optional in the plan; omitted ones defer to the schema column defaults via
// a dynamic column list rather than duplicating those defaults here.
func (s *Store) seedSiteConfig(siteConfig seed.SiteConfigSeed, now string) error {
	commentsEnabled := true
	if siteConfig.CommentsEnabled != nil {
		commentsEnabled = *siteConfig.CommentsEnabled
	}
	columns := []string{"id", "social_json", "comments_enabled", "navigation_json", "sections_json", "updated_at"}
	values := []any{
		"site_1",
		encodeJSON(orDefault(siteConfig.Social, []model.SiteNavigationItem{})),
		boolToInt(commentsEnabled),
		encodeJSON(orDefault(siteConfig.Navigation, defaultNavigation)),
		encodeJSON(orDefault(siteConfig.Sections, defaultSections)),
		now,
	}
	optional := []struct {
		column string
		value  *string
	}{
		{"title", siteConfig.Title},
		{"description", siteConfig.Description},
		{"footer_text", siteConfig.Footer},
	}
	for _, item := range optional {
		if item.value != nil {
			columns = append(columns, item.column)
			values = append(values, *item.value)
		}
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(columns)), ",")
	query := fmt.Sprintf(`INSERT INTO site_config (%s) VALUES (%s)`, strings.Join(columns, ", "), placeholders)
	_, err := s.DB.Exec(query, values...)
	return err
}

func orDefault[T any](values []T, fallback []T) []T {
	if values == nil {
		return fallback
	}
	return values
}

func (s *Store) seedContent(item seed.ContentSeed, index int, now string) error {
	status := item.Status
	if status == "" {
		status = model.StatusPublished
	}
	var publishedAt any
	createdAt := now
	if status == model.StatusPublished {
		publishedAt = now
		if item.PublishedAt != "" {
			publishedAt = item.PublishedAt
			createdAt = item.PublishedAt
		}
	}
	id := item.ID
	if id == "" {
		id = fmt.Sprintf("content_seed_%d", index+1)
	}
	metadata, err := model.NormalizeMetadataFor(item.Kind, item.Body, item.Metadata)
	if err != nil {
		return err
	}
	var title any
	if item.Title != "" {
		title = item.Title
	}
	if _, err := s.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, excerpt, metadata_json, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, item.Kind, status, item.Slug, title, item.Summary, item.Body, contentExcerpt(item.Body), encodeJSON(metadata), publishedAt, createdAt, now); err != nil {
		return err
	}
	for _, tag := range normalizeTags(item.Tags) {
		if _, err := s.DB.Exec(`INSERT INTO content_tags (content_id, tag) VALUES (?, ?)`, id, tag); err != nil {
			return err
		}
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
