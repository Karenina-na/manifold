package tools_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent/tools"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type contentReader struct{ options store.ContentListOptions }

func (reader *contentReader) ListContent(_ context.Context, includeDrafts bool, options store.ContentListOptions) (store.ContentListResult, error) {
	reader.options = options
	title := "A writing"
	published := "2026-09-17T00:00:00Z"
	return store.ContentListResult{Items: []model.Content{{ID: "content_1", Kind: model.ContentKindArticle, Slug: "a-writing", Title: &title, Summary: "Summary", Body: "private body", PublishedAt: &published}}, TotalItems: 1}, nil
}

func TestContentListReturnsBasicMetadataWithoutBody(t *testing.T) {
	reader := &contentReader{}
	result, err := (tools.ContentList{Store: reader, Kind: model.ContentKindArticle}).Execute(t.Context(), json.RawMessage(`{"limit":5}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if string(raw) == "" || json.Valid(raw) == false {
		t.Fatalf("invalid result: %s", raw)
	}
	if reader.options.PageSize != 5 || reader.options.Kinds[0] != model.ContentKindArticle {
		t.Fatalf("unexpected options: %+v", reader.options)
	}
	var output struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &output); err != nil {
		t.Fatal(err)
	}
	if _, exists := output.Items[0]["body"]; exists {
		t.Fatalf("body must not be exposed: %s", raw)
	}
}
