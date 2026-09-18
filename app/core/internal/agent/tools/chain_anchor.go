package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/chain"
)

type ContentAnchorReader interface {
	LatestContentAnchor(ctx context.Context, contentID string) (chain.Anchor, error)
}

type ContentAnchor struct{ Ledger ContentAnchorReader }

func (ContentAnchor) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{
		Name:        "get_content_anchor",
		Description: "Get the latest read-only anchoring certificate and block reference for a content item.",
		Usage:       "Use after get_writing or get_thought when the user asks whether a specific content item is anchored; pass the returned content id. A missing anchor is a known unanchored state, and a pending certificate is not yet in a block.",
		Effect:      agent.ToolEffectReadOnly,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"contentId":{"type":"string","minLength":1,"maxLength":200,"description":"Content id returned by a content tool"}},"required":["contentId"],"additionalProperties":false}`),
	}
}

func (tool ContentAnchor) Execute(ctx context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		ContentID string `json:"contentId"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode content anchor arguments: %w", err)
	}
	contentID := strings.TrimSpace(input.ContentID)
	if contentID == "" || len(contentID) > 200 {
		return nil, errors.New("contentId must contain 1 to 200 characters")
	}
	anchor, err := tool.Ledger.LatestContentAnchor(ctx, contentID)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"contentId": contentID, "anchored": false, "status": "unanchored"}, nil
	}
	if err != nil {
		return nil, err
	}
	status := "pending"
	anchored := false
	if anchor.BlockID != "" {
		status = "anchored"
		anchored = true
	}
	return map[string]any{
		"contentId":     contentID,
		"anchored":      anchored,
		"status":        status,
		"anchorId":      anchor.ID,
		"subjectHash":   anchor.SubjectHash,
		"source":        anchor.Source,
		"subjectRef":    anchor.SubjectRef,
		"label":         anchor.Label,
		"createdAt":     anchor.CreatedAt,
		"blockId":       anchor.BlockID,
		"sitePublicKey": anchor.SitePublicKey,
	}, nil
}
