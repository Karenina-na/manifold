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

// estimateReadingMinutes matches the tokenizer used for word statistics: every
// latin/digit word counts once and every CJK character counts as half a unit.
func estimateReadingMinutes(body string) int {
	latinWords := 0
	cjkCharacters := 0
	inWord := false
	for _, r := range body {
		if isCJKRune(r) {
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

func isCJKRune(r rune) bool {
	return (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x3040 && r <= 0x30ff) || (r >= 0xac00 && r <= 0xd7af)
}
