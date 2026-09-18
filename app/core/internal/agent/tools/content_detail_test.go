package tools_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent/tools"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

type detailReader struct {
	content       model.Content
	err           error
	includeDrafts bool
	slug          string
}

func (reader *detailReader) GetContentBySlug(_ context.Context, slug string, includeDrafts bool) (model.Content, error) {
	reader.slug = slug
	reader.includeDrafts = includeDrafts
	if reader.err != nil {
		return model.Content{}, reader.err
	}
	return reader.content, nil
}

func TestContentDetailReturnsThePublishedBodyForEachContentKind(t *testing.T) {
	for _, test := range []struct {
		name     string
		kind     model.ContentKind
		toolName string
		slug     string
		body     string
	}{
		{name: "writing", kind: model.ContentKindArticle, toolName: "get_writing", slug: "a-writing", body: "# Full writing"},
		{name: "thought", kind: model.ContentKindThought, toolName: "get_thought", slug: "a-thought", body: "A full thought"},
	} {
		t.Run(test.name, func(t *testing.T) {
			title := "A title"
			reader := &detailReader{content: model.Content{
				ID: "content_1", Kind: test.kind, Status: model.StatusPublished,
				Slug: test.slug, Title: &title, Summary: "Summary", Body: test.body,
			}}
			tool := tools.ContentDetail{Store: reader, Kind: test.kind}
			if definition := tool.Definition(); definition.Name != test.toolName || definition.Effect == "" {
				t.Fatalf("unexpected tool definition: %+v", definition)
			}

			result, err := tool.Execute(t.Context(), json.RawMessage(`{"slug":"`+test.slug+`"}`))
			if err != nil {
				t.Fatal(err)
			}
			if reader.slug != test.slug || reader.includeDrafts {
				t.Fatalf("detail lookup must use the requested published slug: %+v", reader)
			}
			raw, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			var output struct {
				Kind string `json:"kind"`
				Slug string `json:"slug"`
				Body string `json:"body"`
			}
			if err := json.Unmarshal(raw, &output); err != nil {
				t.Fatal(err)
			}
			if output.Kind != string(test.kind) || output.Slug != test.slug || output.Body != test.body {
				t.Fatalf("unexpected content detail result: %s", raw)
			}
		})
	}
}

func TestContentDetailRejectsWrongKindAndLookupErrors(t *testing.T) {
	reader := &detailReader{content: model.Content{Kind: model.ContentKindThought, Status: model.StatusPublished}}
	if _, err := (tools.ContentDetail{Store: reader, Kind: model.ContentKindArticle}).Execute(t.Context(), json.RawMessage(`{"slug":"a-thought"}`)); err == nil {
		t.Fatal("expected a thought to be rejected by the writing detail tool")
	}

	reader.err = errors.New("lookup failed")
	if _, err := (tools.ContentDetail{Store: reader, Kind: model.ContentKindArticle}).Execute(t.Context(), json.RawMessage(`{"slug":"a-writing"}`)); err == nil || err.Error() != "lookup failed" {
		t.Fatalf("expected lookup error to be returned, got %v", err)
	}
}
