package model

import (
	"strings"
	"testing"
)

// repeat builds a body of n copies of unit separated by spaces, so the word
// count is n rather than "however many the reader counts".
func repeat(unit string, n int) string {
	return strings.TrimSpace(strings.Repeat(unit+" ", n))
}

func TestEstimateReadingMinutesCountsLatinWordsAtTwoHundredPerMinute(t *testing.T) {
	cases := []struct {
		name string
		body string
		want int
	}{
		// The floor is the point: an empty body and a one-word body both
		// report one minute rather than zero, because "0 min read" is not a
		// thing the UI can render.
		{"empty", "", 1},
		{"one word", "hello", 1},
		{"exactly one minute", repeat("word", 200), 1},
		{"one word over one minute", repeat("word", 201), 2},
		{"exactly two minutes", repeat("word", 400), 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := estimateReadingMinutes(tc.body); got != tc.want {
				t.Fatalf("estimateReadingMinutes(%q...) = %d, want %d", truncate(tc.body), got, tc.want)
			}
		})
	}
}

// CJK is weighted at half a unit here, unlike countWords in internal/store
// which counts one unit per character. docs/core.md documents the two
// tokenizers as deliberately different, so this asserts the weighting rather
// than leaving it to be "simplified" into agreement with the word counter.
func TestEstimateReadingMinutesWeightsCJKCharactersAsHalfAUnit(t *testing.T) {
	cases := []struct {
		name string
		body string
		want int
	}{
		{"two hundred characters is one minute", strings.Repeat("字", 200), 1},
		{"four hundred characters is still one minute", strings.Repeat("字", 400), 1},
		{"four hundred and one characters is two minutes", strings.Repeat("字", 401), 2},
		{"mixed text sums both halves", repeat("word", 100) + " " + strings.Repeat("字", 200), 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := estimateReadingMinutes(tc.body); got != tc.want {
				t.Fatalf("estimateReadingMinutes(%q) = %d, want %d", truncate(tc.body), got, tc.want)
			}
		})
	}
}

func TestDeriveTableOfContentsReadsLevelTwoAndThreeHeadings(t *testing.T) {
	body := "# H1 is not in the table of contents\n## First section\n### Nested section\n## Second section\n"
	got := deriveTableOfContents(body)
	want := []TocItem{
		{ID: "first-section", Label: "First section", Level: 2},
		{ID: "nested-section", Label: "Nested section", Level: 3},
		{ID: "second-section", Label: "Second section", Level: 2},
	}
	assertToc(t, got, want)
}

func TestDeriveTableOfContentsSkipsFencedCode(t *testing.T) {
	body := "## Real heading\n```\n## Not a heading\n```\n~~~\n## Also not a heading\n~~~\n## After the fences\n"
	got := deriveTableOfContents(body)
	want := []TocItem{
		{ID: "real-heading", Label: "Real heading", Level: 2},
		{ID: "after-the-fences", Label: "After the fences", Level: 2},
	}
	assertToc(t, got, want)
}

func TestDeriveTableOfContentsStripsInlineMarkupFromLabels(t *testing.T) {
	body := "## **Bold** and `code` and _emphasis_\n"
	got := deriveTableOfContents(body)
	want := []TocItem{{ID: "bold-and-code-and-emphasis", Label: "Bold and code and emphasis", Level: 2}}
	assertToc(t, got, want)
}

func TestDeriveTableOfContentsDisambiguatesRepeatedHeadings(t *testing.T) {
	body := "## Notes\n## Notes\n## Notes\n"
	got := deriveTableOfContents(body)
	want := []TocItem{
		{ID: "notes", Label: "Notes", Level: 2},
		{ID: "notes-2", Label: "Notes", Level: 2},
		{ID: "notes-3", Label: "Notes", Level: 2},
	}
	assertToc(t, got, want)
}

// A heading that already looks like a generated id must not be handed to the
// second occurrence as a duplicate. The suffix search has to skip ids that are
// taken by a *different* heading, not just by the same one.
func TestDeriveTableOfContentsSkipsIdsAlreadyTakenByAnotherHeading(t *testing.T) {
	body := "## Notes\n## Notes 2\n## Notes\n"
	got := deriveTableOfContents(body)
	want := []TocItem{
		{ID: "notes", Label: "Notes", Level: 2},
		{ID: "notes-2", Label: "Notes 2", Level: 2},
		{ID: "notes-3", Label: "Notes", Level: 2},
	}
	assertToc(t, got, want)
}

func TestDeriveTableOfContentsIgnoresIndentedHeadingsAndBlankLabels(t *testing.T) {
	body := "    ## Four spaces is a code block\n   ## Three spaces is a heading\n## ***\n"
	got := deriveTableOfContents(body)
	want := []TocItem{{ID: "three-spaces-is-a-heading", Label: "Three spaces is a heading", Level: 2}}
	assertToc(t, got, want)
}

func TestDeriveTableOfContentsCapsAtOneHundredEntries(t *testing.T) {
	var builder strings.Builder
	for index := 0; index < 150; index++ {
		builder.WriteString("## Section ")
		builder.WriteString(strings.Repeat("x", 1+index%3))
		builder.WriteString(strings.Repeat("y", index))
		builder.WriteString("\n")
	}
	got := deriveTableOfContents(builder.String())
	if len(got) != 100 {
		t.Fatalf("expected the table of contents to stop at 100 entries, got %d", len(got))
	}
}

func TestDeriveTableOfContentsReturnsAnEmptySliceNotNil(t *testing.T) {
	got := deriveTableOfContents("no headings here\n")
	if got == nil {
		t.Fatal("an article with no headings must still serialize as [], not null")
	}
	if len(got) != 0 {
		t.Fatalf("expected no entries, got %d", len(got))
	}
}

func assertToc(t *testing.T, got, want []TocItem) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d entries %+v, want %d entries %+v", len(got), got, len(want), want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("entry %d = %+v, want %+v", index, got[index], want[index])
		}
	}
}

func truncate(body string) string {
	if len(body) <= 24 {
		return body
	}
	return body[:24] + "..."
}
