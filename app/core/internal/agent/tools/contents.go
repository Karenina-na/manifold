package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type ContentReader interface {
	ListContent(ctx context.Context, includeDrafts bool, options store.ContentListOptions) (store.ContentListResult, error)
}

type ContentList struct {
	Store ContentReader
	Kind  model.ContentKind
}

func (tool ContentList) Definition() agent.ToolDefinition {
	name, noun := "get_thoughts", "thoughts"
	if tool.Kind == model.ContentKindArticle {
		name, noun = "get_writings", "writings"
	}
	return agent.ToolDefinition{Name: name, Description: "Get published " + noun + " with basic metadata and no full body. Choose a limit from 1 to 20.", Parameters: json.RawMessage(`{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":20}},"required":["limit"],"additionalProperties":false}`)}
}

func (tool ContentList) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Limit int `json:"limit"`
	}
	if len(arguments) > 0 {
		if err := json.Unmarshal(arguments, &input); err != nil {
			return nil, fmt.Errorf("decode content arguments: %w", err)
		}
	}
	if input.Limit == 0 {
		input.Limit = 10
	}
	if input.Limit < 1 || input.Limit > 20 {
		return nil, fmt.Errorf("limit must be between 1 and 20")
	}
	result, err := tool.Store.ListContent(ctx, false, store.ContentListOptions{Kinds: []model.ContentKind{tool.Kind}, Sort: "newest", Page: 1, PageSize: input.Limit})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, map[string]any{"id": item.ID, "kind": item.Kind, "slug": item.Slug, "title": item.Title, "summary": item.Summary, "excerpt": item.Excerpt, "tags": item.Tags, "publishedAt": item.PublishedAt, "updatedAt": item.UpdatedAt})
	}
	return map[string]any{"items": items, "totalItems": result.TotalItems}, nil
}
