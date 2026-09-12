package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const schemaVersion = 6

// likePattern wraps a literal search value in a LIKE pattern and neutralises the
// metacharacters inside it. SQLite's LIKE has no default escape character, so
// every caller must also declare `ESCAPE '\'` — without both halves `_` matches
// any single character and `%` matches any run, which silently turns a search
// for `media_ab` or `50%` into a wildcard.
func likePattern(value string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
	return "%" + escaped + "%"
}

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

// nowRFC3339 and timeNowUTC are the same instant in the two shapes this package
// needs: a formatted string for SQL parameters and a Time for arithmetic. One
// derives from the other so there is a single clock decision to change.
func nowRFC3339() string { return timeNowUTC().Format(time.RFC3339) }

func timeNowUTC() time.Time { return time.Now().UTC() }

func newID(prefix string) string {
	return prefix + "_" + time.Now().UTC().Format("20060102150405.000000000")
}

// countWords counts latin/digit words plus CJK characters, one unit each. The
// reading-time estimate in internal/model deliberately weights a CJK character
// as half a unit instead; only the CJK classification is shared
// (model.IsCJKRune), so widening a range cannot desynchronize the two callers.
func countWords(body string) int {
	latinWords, cjkCharacters := 0, 0
	inWord := false
	for _, r := range body {
		if model.IsCJKRune(r) {
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
