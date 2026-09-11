package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const schemaVersion = 6

var (
	ErrContentNotFound     = errors.New("content not found")
	ErrVersionConflict     = errors.New("content version conflict")
	ErrSlugTaken           = errors.New("content slug already taken")
	ErrCommentReplyInvalid = errors.New("comment reply target is invalid")
	ErrCommentDeleted      = errors.New("comment is deleted")
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
	Kinds         []model.ContentKind
	Status        model.ContentStatus
	Tags          []string
	Query         string
	AiAssisted    *bool
	PinnedIDsOnly bool
	Sort          string
	Page          int
	PageSize      int
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

func (s *Store) Close() error { return s.DB.Close() }

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
