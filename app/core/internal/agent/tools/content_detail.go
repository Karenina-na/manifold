package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type ContentDetailReader interface {
	GetContentBySlug(ctx context.Context, slug string, includeDrafts bool) (model.Content, error)
}

type ContentDetail struct {
	Store ContentDetailReader
	Kind  model.ContentKind
}

func (tool ContentDetail) Definition() agent.ToolDefinition {
	name, noun, listTool := "get_thought", "thought", "get_thoughts"
	if tool.Kind == model.ContentKindArticle {
		name, noun, listTool = "get_writing", "writing", "get_writings"
	}
	return agent.ToolDefinition{
		Name:        name,
		Description: "Get one published " + noun + " by slug, including its full Markdown body and metadata.",
		Usage:       "Use when the user asks about the full body of a specific published " + noun + ". Use a slug from " + listTool + "; this tool never returns drafts or another content kind.",
		Effect:      agent.ToolEffectReadOnly,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","minLength":1,"maxLength":200,"description":"Published content slug"}},"required":["slug"],"additionalProperties":false}`),
	}
}

func (tool ContentDetail) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode content detail arguments: %w", err)
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
	if content.Kind != tool.Kind || content.Status != model.StatusPublished {
		return nil, errors.New("requested content is not a published item of the requested kind")
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
