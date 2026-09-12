package store

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/manifold-space/manifold/app/core/db"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/seed"
)

// Open migrates and seeds on the way up, so it takes a context: a shutdown that
// lands during startup has to be able to abort that work rather than run it to
// completion against a database nobody is waiting for any more.
func Open(ctx context.Context, path string, options ...Option) (*Store, error) {
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
	database, err := sql.Open("sqlite", databaseDSN(path))
	if err != nil {
		return nil, err
	}
	// SQLite is safest as a single-writer connection for this workload; it
	// also makes transactions trivially serializable without busy retries.
	database.SetMaxOpenConns(1)
	s := &Store{DB: database}
	if err := s.migrate(ctx); err != nil {
		_ = database.Close()
		return nil, err
	}
	if err := s.applySeed(ctx, plan); err != nil {
		_ = database.Close()
		return nil, err
	}
	if err := s.ensureAdminCredential(ctx, oo.adminUsername, oo.adminPasswordHash); err != nil {
		_ = database.Close()
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

// databaseDSN attaches the connection-scoped pragmas to the database path.
// foreign_keys is per-connection state, so it has to travel in the DSN: running
// PRAGMA foreign_keys = ON once after opening only configures the connection it
// happened to run on, and the constraint would silently lapse the moment the
// pool retired that connection — taking the comments.reply_to_id, pins.content_id
// and chain_anchors.block_id foreign keys with it. The driver applies
// _pragma=... on every new connection, including the ":memory:" form, whose
// query string it strips from the filename before opening.
func databaseDSN(path string) string {
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	return path + separator + "_pragma=foreign_keys(1)"
}

// migrate applies every embedded migration below the schema's known version.
// A database from a newer binary refuses to open rather than being silently
// downgraded.
func (s *Store) migrate(ctx context.Context) error {
	var userVersion int
	if err := s.DB.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&userVersion); err != nil {
		return err
	}
	var existingTables int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations'`).Scan(&existingTables); err != nil {
		return err
	}
	if existingTables > 0 && userVersion > schemaVersion {
		return fmt.Errorf("%w: database at %d, binary knows %d; upgrade the Core binary", ErrSchemaMismatch, userVersion, schemaVersion)
	}
	if _, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		return err
	}
	var current int
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
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
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(script)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	if _, err := s.DB.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		return err
	}
	return nil
}

// applySeed populates a fresh database from the plan resolved at Open time.
// The gate counts profile rows instead of content rows so an admin who deletes
// every seeded article does not resurrect starter data on restart.
func (s *Store) applySeed(ctx context.Context, plan seed.Plan) error {
	var seeded int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM profile`).Scan(&seeded); err != nil {
		return err
	}
	if seeded > 0 {
		return nil
	}
	now := nowRFC3339()
	profile := plan.Profile
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO profile (id, display_name, handle, headline, bio, location, avatar_url, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at) VALUES ('profile_1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		profile.DisplayName, profile.Handle, profile.Headline, profile.Bio, profile.Location, profile.AvatarURL, profile.Organization, profile.WebsiteURL, profile.ResumeURL,
		encodeJSON(profile.Interests), encodeJSON(profile.Education), encodeJSON(profile.Experience), encodeJSON(profile.Series), encodeJSON(profile.Contacts), now); err != nil {
		return err
	}
	if err := s.seedSiteConfig(ctx, plan.SiteConfig, now); err != nil {
		return err
	}
	for index, item := range plan.Contents {
		if err := s.seedContent(ctx, item, index, now); err != nil {
			return err
		}
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO thoughts_config (id, updated_at) VALUES ('thoughts_1', ?)`, now); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO writings_config (id, updated_at) VALUES ('writings_1', ?)`, now); err != nil {
		return err
	}
	return nil
}

// seedSiteConfig inserts the site_config singleton. Site identity fields are
// optional in the plan; omitted ones defer to the schema column defaults via
// a dynamic column list rather than duplicating those defaults here.
func (s *Store) seedSiteConfig(ctx context.Context, siteConfig seed.SiteConfigSeed, now string) error {
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
	_, err := s.DB.ExecContext(ctx, query, values...)
	return err
}

func orDefault[T any](values []T, fallback []T) []T {
	if values == nil {
		return fallback
	}
	return values
}

func (s *Store) seedContent(ctx context.Context, item seed.ContentSeed, index int, now string) error {
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
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO content (id, kind, status, slug, title, summary, body, excerpt, metadata_json, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, item.Kind, status, item.Slug, title, item.Summary, item.Body, contentExcerpt(item.Body), encodeJSON(metadata), publishedAt, createdAt, now); err != nil {
		return err
	}
	for _, tag := range normalizeTags(item.Tags) {
		if _, err := s.DB.ExecContext(ctx, `INSERT INTO content_tags (content_id, tag) VALUES (?, ?)`, id, tag); err != nil {
			return err
		}
	}
	return nil
}
