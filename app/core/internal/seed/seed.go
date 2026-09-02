// Package seed owns the baseline data applied to an empty database. The
// embedded JSON files are the single customization point for default profile,
// site configuration, and starter content; internal/store consumes parsed
// plans and nothing else in the binary hardcodes seed rows.
package seed

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

//go:embed bootstrap.json dev.json
var files embed.FS

// Plan is the parsed, validated form of a seed document. Derived fields
// (excerpt, reading minutes, TOC) and timestamps stay the store's job so the
// plan never drifts from persisted derivations.
type Plan struct {
	Profile    ProfileSeed    `json:"profile"`
	SiteConfig SiteConfigSeed `json:"siteConfig"`
	Contents   []ContentSeed  `json:"contents"`
}

// ProfileSeed carries the site owner identity for the profile singleton.
type ProfileSeed struct {
	DisplayName  string                        `json:"displayName"`
	Handle       string                        `json:"handle"`
	Headline     string                        `json:"headline"`
	Bio          string                        `json:"bio"`
	Location     string                        `json:"location"`
	Organization string                        `json:"organization"`
	WebsiteURL   string                        `json:"websiteUrl"`
	ResumeURL    string                        `json:"resumeUrl"`
	AvatarURL    string                        `json:"avatarUrl"`
	Interests    []string                      `json:"interests"`
	Education    []model.ProfileEducationItem  `json:"education"`
	Experience   []model.ProfileExperienceItem `json:"experience"`
	Series       []model.ProfileSeriesItem     `json:"series"`
	Contacts     []model.ProfileContact        `json:"contacts"`
}

// SiteConfigSeed carries the home composition for the site_config singleton.
// Pointer fields fall back to the database column defaults when absent.
type SiteConfigSeed struct {
	Title           *string                    `json:"title"`
	Description     *string                    `json:"description"`
	Footer          *string                    `json:"footer"`
	Social          []model.SiteNavigationItem `json:"social"`
	CommentsEnabled *bool                      `json:"commentsEnabled"`
	Navigation      []model.SiteNavigationItem `json:"navigation"`
	Sections        []string                   `json:"sections"`
}

// ContentSeed is one starter content row. The identifier may be empty; the
// store then generates one. Status defaults to PUBLISHED, and publishedAt
// backdates publication (and creation) timestamps of published items.
type ContentSeed struct {
	ID          string                 `json:"id"`
	Kind        model.ContentKind      `json:"kind"`
	Slug        string                 `json:"slug"`
	Title       string                 `json:"title"`
	Summary     string                 `json:"summary"`
	Body        string                 `json:"body"`
	Status      model.ContentStatus    `json:"status"`
	Tags        []string               `json:"tags"`
	Metadata    json.RawMessage        `json:"metadata"`
	PublishedAt string                 `json:"publishedAt"`
}

// Bootstrap returns the structural-only plan (profile + site config, no
// content). This is what production databases are initialized with.
func Bootstrap() (Plan, error) {
	return decode("bootstrap.json")
}

// Dev returns the built-in development plan: the bootstrap skeleton plus a
// small published starter set used by tests and local runs.
func Dev() (Plan, error) {
	return decode("dev.json")
}

// LoadFile parses a custom seed document from disk. A missing profile or
// siteConfig falls back to the built-in bootstrap defaults, and navigation or
// sections fall back per field; contents always come from the file.
func LoadFile(path string) (Plan, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Plan{}, fmt.Errorf("read seed file: %w", err)
	}
	plan, err := compose(raw, path)
	if err != nil {
		return Plan{}, fmt.Errorf("seed file %s: %w", path, err)
	}
	return plan, nil
}

// Resolve picks the plan for a run. Production always receives a clean
// content database: a custom file may shape the profile and site config but
// its contents are dropped. Development uses the configured file when present
// and falls back to the built-in dev data. The env value follows the CORE_ENV
// contract where only "production" is special.
func Resolve(env, seedFile string) (Plan, error) {
	if env == "production" {
		plan, err := bootstrapOrFile(seedFile)
		if err != nil {
			return Plan{}, err
		}
		return plan.WithoutContents(), nil
	}
	if seedFile == "" {
		return Dev()
	}
	return LoadFile(seedFile)
}

func bootstrapOrFile(seedFile string) (Plan, error) {
	if seedFile == "" {
		return Bootstrap()
	}
	return LoadFile(seedFile)
}

// seedDocument mirrors a seed file with optional top-level keys so custom
// files can override only what they care about.
type seedDocument struct {
	Profile    *ProfileSeed    `json:"profile"`
	SiteConfig *SiteConfigSeed `json:"siteConfig"`
	Contents   []ContentSeed   `json:"contents"`
}

func decode(name string) (Plan, error) {
	raw, err := files.ReadFile(name)
	if err != nil {
		return Plan{}, fmt.Errorf("read embedded seed %s: %w", name, err)
	}
	var document seedDocument
	if err := strictUnmarshal(raw, &document); err != nil {
		return Plan{}, fmt.Errorf("parse seed %s: %w", name, err)
	}
	plan, err := build(document, name)
	if err != nil {
		return Plan{}, err
	}
	return plan, nil
}

// compose merges a custom document over the built-in bootstrap defaults.
func compose(raw []byte, name string) (Plan, error) {
	defaults, err := Bootstrap()
	if err != nil {
		return Plan{}, err
	}
	var document seedDocument
	if err := strictUnmarshal(raw, &document); err != nil {
		return Plan{}, fmt.Errorf("parse seed: %w", err)
	}
	plan := Plan{Profile: defaults.Profile, SiteConfig: defaults.SiteConfig}
	if document.Profile != nil {
		plan.Profile = *document.Profile
	}
	if document.SiteConfig != nil {
		siteConfig := *document.SiteConfig
		if siteConfig.Navigation == nil {
			siteConfig.Navigation = defaults.SiteConfig.Navigation
		}
		if siteConfig.Sections == nil {
			siteConfig.Sections = defaults.SiteConfig.Sections
		}
		plan.SiteConfig = siteConfig
	}
	plan.Contents = document.Contents
	normalize(&plan)
	if err := plan.Validate(); err != nil {
		return Plan{}, fmt.Errorf("seed %s: %w", name, err)
	}
	return plan, nil
}

func build(document seedDocument, name string) (Plan, error) {
	plan := Plan{}
	if document.Profile != nil {
		plan.Profile = *document.Profile
	}
	if document.SiteConfig != nil {
		plan.SiteConfig = *document.SiteConfig
	}
	plan.Contents = document.Contents
	normalize(&plan)
	if err := plan.Validate(); err != nil {
		return Plan{}, fmt.Errorf("seed %s: %w", name, err)
	}
	return plan, nil
}

func strictUnmarshal(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

// normalize replaces nil slices with empty ones so persisted JSON columns
// never contain the literal "null".
func normalize(plan *Plan) {
	if plan.Profile.Interests == nil {
		plan.Profile.Interests = []string{}
	}
	if plan.Profile.Education == nil {
		plan.Profile.Education = []model.ProfileEducationItem{}
	}
	if plan.Profile.Experience == nil {
		plan.Profile.Experience = []model.ProfileExperienceItem{}
	}
	if plan.Profile.Series == nil {
		plan.Profile.Series = []model.ProfileSeriesItem{}
	}
	if plan.Profile.Contacts == nil {
		plan.Profile.Contacts = []model.ProfileContact{}
	}
	if plan.SiteConfig.Social == nil {
		plan.SiteConfig.Social = []model.SiteNavigationItem{}
	}
	for index := range plan.Contents {
		if plan.Contents[index].Tags == nil {
			plan.Contents[index].Tags = []string{}
		}
	}
}

var allowedSections = map[string]bool{
	"PROFILE": true, "BACKGROUND": true, "RECENT_CONTENT": true,
	"UPDATES": true, "SERIES": true, "CONTACT": true,
}

// Validate enforces the file contract: required identity fields, section
// enum, unique slugs and identifiers, and kind-specific metadata shapes.
func (p Plan) Validate() error {
	if strings.TrimSpace(p.Profile.DisplayName) == "" {
		return fmt.Errorf("profile.displayName is required")
	}
	if len(p.SiteConfig.Navigation) == 0 {
		return fmt.Errorf("siteConfig.navigation must not be empty")
	}
	for _, item := range p.SiteConfig.Navigation {
		if strings.TrimSpace(item.Label) == "" || strings.TrimSpace(item.Href) == "" {
			return fmt.Errorf("siteConfig.navigation items need label and href")
		}
	}
	seenSections := make(map[string]bool, len(p.SiteConfig.Sections))
	for _, section := range p.SiteConfig.Sections {
		if !allowedSections[section] {
			return fmt.Errorf("siteConfig.sections entry %q is not one of PROFILE/BACKGROUND/RECENT_CONTENT/UPDATES/SERIES/CONTACT", section)
		}
		if seenSections[section] {
			return fmt.Errorf("siteConfig.sections entry %q is duplicated", section)
		}
		seenSections[section] = true
	}
	slugs := make(map[string]bool, len(p.Contents))
	ids := make(map[string]bool, len(p.Contents))
	for index, item := range p.Contents {
		field := fmt.Sprintf("contents[%d]", index)
		if item.Kind != model.ContentKindThought && item.Kind != model.ContentKindArticle {
			return fmt.Errorf("%s.kind must be THOUGHT or ARTICLE, got %q", field, item.Kind)
		}
		status := item.Status
		if status == "" {
			status = model.StatusPublished
		}
		if status != model.StatusPublished && status != model.StatusDraft {
			return fmt.Errorf("%s.status must be DRAFT or PUBLISHED, got %q", field, item.Status)
		}
		if strings.TrimSpace(item.Slug) == "" {
			return fmt.Errorf("%s.slug is required", field)
		}
		if slugs[item.Slug] {
			return fmt.Errorf("%s.slug %q is duplicated", field, item.Slug)
		}
		slugs[item.Slug] = true
		if item.ID != "" {
			if ids[item.ID] {
				return fmt.Errorf("%s.id %q is duplicated", field, item.ID)
			}
			ids[item.ID] = true
		}
		if item.PublishedAt != "" {
			if _, err := time.Parse(time.RFC3339, item.PublishedAt); err != nil {
				return fmt.Errorf("%s.publishedAt must be RFC3339: %w", field, err)
			}
		}
		if len(item.Metadata) > 0 {
			if _, err := model.NormalizeMetadataFor(item.Kind, item.Body, item.Metadata); err != nil {
				return fmt.Errorf("%s.metadata: %w", field, err)
			}
		}
	}
	return nil
}

// WithoutContents returns a copy of the plan that keeps the structural
// skeleton but drops starter content, so production databases start with an
// empty content store.
func (p Plan) WithoutContents() Plan {
	p.Contents = nil
	return p
}
