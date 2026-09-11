package store

import (
	"regexp"
	"strings"
)

const contentExcerptMaxRunes = 360

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
