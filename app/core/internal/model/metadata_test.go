package model

import (
	"encoding/json"
	"testing"
)

// The kind-discriminated metadata union is the Core boundary for what a row is
// allowed to carry, and it had no test at all. These cases pin the two rules
// the store depends on: unknown keys are rejected rather than dropped, and the
// derived ARTICLE fields overwrite whatever the caller sent.
func TestNormalizeMetadataForThoughtAcceptsTheTypedShape(t *testing.T) {
	raw := json.RawMessage(`{"mood":"calm","question":"why?","context":null,"source":"a book"}`)
	metadata, err := NormalizeMetadataFor(ContentKindThought, "body text", raw)
	if err != nil {
		t.Fatal(err)
	}
	thought, ok := metadata.(ThoughtMetadata)
	if !ok {
		t.Fatalf("expected ThoughtMetadata, got %T", metadata)
	}
	if thought.Mood == nil || *thought.Mood != "calm" {
		t.Fatalf("mood was not carried through: %+v", thought)
	}
	if thought.Question == nil || *thought.Question != "why?" {
		t.Fatalf("question was not carried through: %+v", thought)
	}
	if thought.Context != nil {
		t.Fatalf("an explicit null must stay null, got %q", *thought.Context)
	}
	if thought.Source == nil || *thought.Source != "a book" {
		t.Fatalf("source was not carried through: %+v", thought)
	}
}

func TestNormalizeMetadataForThoughtWithoutRawIsTheEmptyShape(t *testing.T) {
	metadata, err := NormalizeMetadataFor(ContentKindThought, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if thought, ok := metadata.(ThoughtMetadata); !ok || thought != (ThoughtMetadata{}) {
		t.Fatalf("expected the zero ThoughtMetadata, got %#v", metadata)
	}
}

// DisallowUnknownFields is what keeps a client from smuggling a field Core does
// not model into a persisted row: it must be an error, not a silent drop.
func TestNormalizeMetadataForRejectsUnknownFields(t *testing.T) {
	cases := []struct {
		name string
		kind ContentKind
		raw  string
	}{
		{"thought", ContentKindThought, `{"mood":"calm","surprise":"extra"}`},
		{"article", ContentKindArticle, `{"readingMinutes":3,"surprise":"extra"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NormalizeMetadataFor(tc.kind, "## Heading\n", json.RawMessage(tc.raw)); err == nil {
				t.Fatal("expected an unknown metadata field to be rejected")
			}
		})
	}
}

func TestNormalizeMetadataForArticleDerivesReadingTimeAndToc(t *testing.T) {
	body := "## Introduction\nsome words\n### Detail\n"
	raw := json.RawMessage(`{"language":"en","aiAssisted":true}`)
	metadata, err := NormalizeMetadataFor(ContentKindArticle, body, raw)
	if err != nil {
		t.Fatal(err)
	}
	article, ok := metadata.(ArticleMetadata)
	if !ok {
		t.Fatalf("expected ArticleMetadata, got %T", metadata)
	}
	if article.Language == nil || *article.Language != "en" || !article.AiAssisted {
		t.Fatalf("editorial fields were not preserved: %+v", article)
	}
	if article.ReadingMinutes != estimateReadingMinutes(body) {
		t.Fatalf("readingMinutes = %d, want the derived %d", article.ReadingMinutes, estimateReadingMinutes(body))
	}
	assertToc(t, article.Toc, []TocItem{
		{ID: "introduction", Label: "Introduction", Level: 2},
		{ID: "detail", Label: "Detail", Level: 3},
	})
}

// Derived means authoritative: a caller-supplied readingMinutes or toc must not
// survive. If this ever flips, the stored reading time stops matching the body.
func TestNormalizeMetadataForArticleOverwritesDerivedFields(t *testing.T) {
	body := "## Real heading\n"
	raw := json.RawMessage(`{"readingMinutes":9999,"toc":[{"id":"forged","label":"Forged","level":2}],"aiAssisted":false}`)
	metadata, err := NormalizeMetadataFor(ContentKindArticle, body, raw)
	if err != nil {
		t.Fatal(err)
	}
	article := metadata.(ArticleMetadata)
	if article.ReadingMinutes == 9999 {
		t.Fatal("a caller-supplied readingMinutes must be overwritten by the derived value")
	}
	assertToc(t, article.Toc, []TocItem{{ID: "real-heading", Label: "Real heading", Level: 2}})
}

func TestNormalizeMetadataForArticleWithoutHeadingsSerializesAsEmptyList(t *testing.T) {
	metadata, err := NormalizeMetadataFor(ContentKindArticle, "plain body", nil)
	if err != nil {
		t.Fatal(err)
	}
	article := metadata.(ArticleMetadata)
	if article.Toc == nil {
		t.Fatal("toc must be an empty slice so it marshals as [], not null")
	}
	if len(article.Toc) != 0 {
		t.Fatalf("expected no entries, got %d", len(article.Toc))
	}
}

// An unrecognized kind falls back to the THOUGHT shape rather than erroring.
// That is the current behaviour; it is asserted so a change is deliberate.
func TestNormalizeMetadataForUnknownKindFallsBackToThought(t *testing.T) {
	metadata, err := NormalizeMetadataFor(ContentKind("OTHER"), "body", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := metadata.(ThoughtMetadata); !ok {
		t.Fatalf("expected the THOUGHT fallback, got %T", metadata)
	}
}

func TestEmptyMetadataForReturnsTheKindsZeroShape(t *testing.T) {
	if _, ok := EmptyMetadataFor(ContentKindArticle).(ArticleMetadata); !ok {
		t.Fatal("ARTICLE must normalize to ArticleMetadata")
	}
	if _, ok := EmptyMetadataFor(ContentKindThought).(ThoughtMetadata); !ok {
		t.Fatal("THOUGHT must normalize to ThoughtMetadata")
	}
}
