package model

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var (
	markdownHeadingPattern = regexp.MustCompile(`^ {0,3}(#{2,3})\s+(.+?)\s*$`)
	markdownLabelPattern   = regexp.MustCompile(`[*_` + "`" + `~]`)
)

// estimateReadingMinutes counts latin/digit words and CJK characters like the
// word-statistics tokenizer does, but weights a CJK character as half a unit
// instead of a whole one: the unit is a reading-speed estimate, not a word
// count, so the two intentionally do not agree on CJK-heavy text.
func estimateReadingMinutes(body string) int {
	latinWords := 0
	cjkCharacters := 0
	inWord := false
	for _, r := range body {
		if IsCJKRune(r) {
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
	units := latinWords + (cjkCharacters+1)/2
	minutes := (units + 199) / 200
	if minutes < 1 {
		return 1
	}
	return minutes
}

func deriveTableOfContents(body string) []TocItem {
	entries := make([]TocItem, 0)
	usedIDs := make(map[string]int)
	inFence := false
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(strings.TrimRight(line, "\r"))
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		match := markdownHeadingPattern.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if match == nil {
			continue
		}
		label := strings.TrimSpace(markdownLabelPattern.ReplaceAllString(match[2], ""))
		id := slugifyHeading(label)
		if label == "" || id == "" {
			continue
		}
		baseID := id
		for count := usedIDs[baseID]; ; count++ {
			candidate := baseID
			if count > 0 {
				candidate = baseID + "-" + strconv.Itoa(count+1)
			}
			if _, exists := usedIDs[candidate]; !exists {
				id = candidate
				usedIDs[baseID] = count + 1
				usedIDs[candidate] = 1
				break
			}
		}
		level := 2
		if len(match[1]) == 3 {
			level = 3
		}
		entries = append(entries, TocItem{ID: id, Label: label, Level: level})
		if len(entries) >= 100 {
			break
		}
	}
	return entries
}

func slugifyHeading(value string) string {
	var builder strings.Builder
	separator := false
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if separator && builder.Len() > 0 {
				builder.WriteByte('-')
			}
			builder.WriteRune(r)
			separator = false
			continue
		}
		separator = true
	}
	return strings.Trim(builder.String(), "-")
}

// IsCJKRune reports whether r belongs to one of the CJK blocks counted as
// characters rather than as word separators. The classification is shared with
// the word-statistics tokenizer in internal/store — an earlier version of this
// file and that one each carried their own copy of the same four ranges, so
// widening one silently desynchronized the other. The *weighting* is what
// deliberately differs between the two callers, not which runes are CJK.
func IsCJKRune(r rune) bool {
	return (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x3040 && r <= 0x30ff) || (r >= 0xac00 && r <= 0xd7af)
}
