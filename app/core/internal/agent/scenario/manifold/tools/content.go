package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type ContentReader interface {
	ListContent(ctx context.Context, includeDrafts bool, options store.ContentListOptions) (store.ContentListResult, error)
	GetContentBySlug(ctx context.Context, slug string, includeDrafts bool) (model.Content, error)
}

type ContentList struct{ Store ContentReader }

func (ContentList) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{
		Name:        "content_list",
		Description: "List published Manifold content with basic metadata and summaries; full bodies are omitted.",
		Usage:       "Use when the user asks about current or stored content, themes, or metadata. Optionally filter by kind; use content_get for the full body of a specific item.",
		Effect:      agenttool.ToolEffectReadOnly,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"kind":{"type":"string","enum":["ARTICLE","THOUGHT"],"description":"Optional content kind filter"},"limit":{"type":"integer","minimum":1,"maximum":20,"default":10,"description":"Maximum number of items"}},"additionalProperties":false}`),
	}
}

func (tool ContentList) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Kind  string `json:"kind"`
		Limit int    `json:"limit"`
	}
	if len(arguments) > 0 {
		if err := json.Unmarshal(arguments, &input); err != nil {
			return nil, fmt.Errorf("decode content list arguments: %w", err)
		}
	}
	if input.Limit == 0 {
		input.Limit = 10
	}
	if input.Limit < 1 || input.Limit > 20 {
		return nil, errors.New("limit must be between 1 and 20")
	}
	kind, err := parseContentKind(input.Kind)
	if err != nil {
		return nil, err
	}
	options := store.ContentListOptions{Sort: "newest", Page: 1, PageSize: input.Limit}
	if kind != "" {
		options.Kinds = []model.ContentKind{kind}
	}
	result, err := tool.Store.ListContent(ctx, false, options)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, map[string]any{
			"id":          item.ID,
			"kind":        item.Kind,
			"slug":        item.Slug,
			"title":       item.Title,
			"summary":     item.Summary,
			"excerpt":     item.Excerpt,
			"tags":        item.Tags,
			"publishedAt": item.PublishedAt,
			"updatedAt":   item.UpdatedAt,
		})
	}
	return map[string]any{"items": items, "totalItems": result.TotalItems}, nil
}

type ContentGet struct{ Store ContentReader }

func (ContentGet) Definition() agenttool.ToolDefinition {
	return agenttool.ToolDefinition{
		Name:        "content_get",
		Description: "Get one published Manifold content item by slug, including its full Markdown body and metadata.",
		Usage:       "Use when the user asks about the full body of a specific published content item. Use a slug from content_list; this tool never returns drafts.",
		Effect:      agenttool.ToolEffectReadOnly,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","minLength":1,"maxLength":200,"description":"Published content slug"}},"required":["slug"],"additionalProperties":false}`),
	}
}

func (tool ContentGet) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode content get arguments: %w", err)
	}
	slug := strings.TrimSpace(input.Slug)
	if slug == "" || len(slug) > 200 {
		return nil, errors.New("slug must contain 1 to 200 characters")
	}
	content, err := tool.Store.GetContentBySlug(ctx, slug, false)
	if err != nil {
		if errors.Is(err, store.ErrContentNotFound) {
			return nil, fmt.Errorf("content %q was not found", slug)
		}
		return nil, err
	}
	if content.Status != model.StatusPublished {
		return nil, errors.New("requested content is not published")
	}
	publishedAt := ""
	if content.PublishedAt != nil {
		publishedAt = *content.PublishedAt
	}
	return map[string]any{
		"id":          content.ID,
		"kind":        content.Kind,
		"slug":        content.Slug,
		"title":       content.Title,
		"summary":     content.Summary,
		"body":        content.Body,
		"excerpt":     content.Excerpt,
		"tags":        content.Tags,
		"metadata":    content.Metadata,
		"publishedAt": publishedAt,
		"updatedAt":   content.UpdatedAt,
	}, nil
}

func parseContentKind(value string) (model.ContentKind, error) {
	switch kind := model.ContentKind(strings.ToUpper(strings.TrimSpace(value))); kind {
	case "":
		return "", nil
	case model.ContentKindArticle, model.ContentKindThought:
		return kind, nil
	default:
		return "", fmt.Errorf("kind must be ARTICLE or THOUGHT")
	}
}
