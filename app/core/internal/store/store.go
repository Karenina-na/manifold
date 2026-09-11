package store

import (
	"database/sql"
	"encoding/json"
	"errors"
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

var defaultSections = []string{"PROFILE", "BACKGROUND", "RECENT_CONTENT", "UPDATES", "SERIES", "CONTACT"}

var defaultNavigation = []model.SiteNavigationItem{{Label: "Home", Href: "/"}, {Label: "Writings", Href: "/writing"}, {Label: "Thoughts", Href: "/thoughts"}}

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
