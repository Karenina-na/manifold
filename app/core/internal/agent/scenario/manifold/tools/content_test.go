package tools_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	manifoldtools "github.com/manifold-space/manifold/app/core/internal/agent/scenario/manifold/tools"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type contentReader struct {
	options       store.ContentListOptions
	listResult    store.ContentListResult
	content       model.Content
	contentErr    error
	includeDrafts bool
	slug          string
}

func (reader *contentReader) ListContent(_ context.Context, includeDrafts bool, options store.ContentListOptions) (store.ContentListResult, error) {
	reader.options = options
	reader.includeDrafts = includeDrafts
	return reader.listResult, nil
}

func (reader *contentReader) GetContentBySlug(_ context.Context, slug string, includeDrafts bool) (model.Content, error) {
	reader.slug = slug
	reader.includeDrafts = includeDrafts
	if reader.contentErr != nil {
		return model.Content{}, reader.contentErr
	}
	return reader.content, nil
}

func TestContentListReturnsMixedPublishedMetadataWithoutBodies(t *testing.T) {
	title := "A writing"
	reader := &contentReader{listResult: store.ContentListResult{
		Items: []model.Content{
			{ID: "article_1", Kind: model.ContentKindArticle, Slug: "a-writing", Title: &title, Summary: "Writing summary", Body: "private writing body"},
			{ID: "thought_1", Kind: model.ContentKindThought, Slug: "a-thought", Summary: "Thought summary", Body: "private thought body"},
		},
		TotalItems: 2,
	}}
	registered := manifoldtools.ContentList{Store: reader}
	definition := registered.Definition()
	if definition.Name != "content_list" || definition.Effect != agenttool.ToolEffectReadOnly {
		t.Fatalf("unexpected content_list definition: %+v", definition)
	}

	result, err := registered.Execute(t.Context(), json.RawMessage(`{"limit":5}`))
	if err != nil {
		t.Fatal(err)
	}
	if reader.options.PageSize != 5 || len(reader.options.Kinds) != 0 || reader.includeDrafts {
		t.Fatalf("content_list must query mixed published content: %+v", reader)
	}
	raw, err := json.Marshal(result)
	if err != nil || !json.Valid(raw) {
		t.Fatalf("invalid result: %s (%v)", raw, err)
	}
	var output struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &output); err != nil {
		t.Fatal(err)
	}
	if len(output.Items) != 2 || output.Items[0]["kind"] == nil || output.Items[1]["kind"] == nil {
		t.Fatalf("content_list must retain content kinds: %s", raw)
	}
	for _, item := range output.Items {
		if _, exists := item["body"]; exists {
			t.Fatalf("content_list must not expose bodies: %s", raw)
		}
	}
}

func TestContentListAcceptsAnOptionalKindFilter(t *testing.T) {
	reader := &contentReader{}
	_, err := (manifoldtools.ContentList{Store: reader}).Execute(t.Context(), json.RawMessage(`{"kind":"thought","limit":3}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.options.Kinds) != 1 || reader.options.Kinds[0] != model.ContentKindThought || reader.options.PageSize != 3 {
		t.Fatalf("unexpected content kind filter: %+v", reader.options)
	}

	if _, err := (manifoldtools.ContentList{Store: reader}).Execute(t.Context(), json.RawMessage(`{"kind":"profile"}`)); err == nil {
		t.Fatal("expected an unsupported content kind to be rejected")
	}
}

func TestContentGetReturnsThePublishedBodyForEachContentKind(t *testing.T) {
	for _, test := range []struct {
		name string
		kind model.ContentKind
		slug string
		body string
	}{
		{name: "writing", kind: model.ContentKindArticle, slug: "a-writing", body: "# Full writing"},
		{name: "thought", kind: model.ContentKindThought, slug: "a-thought", body: "A full thought"},
	} {
		t.Run(test.name, func(t *testing.T) {
			title := "A title"
			reader := &contentReader{content: model.Content{
				ID: "content_1", Kind: test.kind, Status: model.StatusPublished,
				Slug: test.slug, Title: &title, Summary: "Summary", Body: test.body,
			}}
			registered := manifoldtools.ContentGet{Store: reader}
			if definition := registered.Definition(); definition.Name != "content_get" || definition.Effect != agenttool.ToolEffectReadOnly {
				t.Fatalf("unexpected content_get definition: %+v", definition)
			}

			result, err := registered.Execute(t.Context(), json.RawMessage(`{"slug":"`+test.slug+`"}`))
			if err != nil {
				t.Fatal(err)
			}
			if reader.slug != test.slug || reader.includeDrafts {
				t.Fatalf("content_get must use the requested published slug: %+v", reader)
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
				t.Fatalf("unexpected content_get result: %s", raw)
			}
		})
	}
}

func TestContentGetRejectsDraftsAndLookupErrors(t *testing.T) {
	reader := &contentReader{content: model.Content{Kind: model.ContentKindThought, Status: model.StatusDraft}}
	if _, err := (manifoldtools.ContentGet{Store: reader}).Execute(t.Context(), json.RawMessage(`{"slug":"a-thought"}`)); err == nil {
		t.Fatal("expected a draft to be rejected by content_get")
	}

	reader.contentErr = errors.New("lookup failed")
	if _, err := (manifoldtools.ContentGet{Store: reader}).Execute(t.Context(), json.RawMessage(`{"slug":"a-writing"}`)); err == nil || err.Error() != "lookup failed" {
		t.Fatalf("expected lookup error to be returned, got %v", err)
	}
}
