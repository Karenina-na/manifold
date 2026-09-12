package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/chain"
)

// anchorView is the HTTP wire shape of chain.Anchor (mirrors ChainAnchor in
// packages/contracts): BlockID maps to status/blockId; Summary and Target are
// derived by the handler from live business rows so the explorer can say what
// a subject hash stands for and where it leads.
type anchorView struct {
	ID            string            `json:"id"`
	SubjectHash   string            `json:"subjectHash"`
	Source        string            `json:"source"`
	SubjectRef    string            `json:"subjectRef"`
	Label         string            `json:"label"`
	Metadata      map[string]any    `json:"metadata"`
	SiteKeyID     string            `json:"siteKeyId"`
	SitePublicKey string            `json:"sitePublicKey"`
	SiteSignature string            `json:"siteSignature"`
	CreatedAt     string            `json:"createdAt"`
	Status        string            `json:"status"`
	BlockID       *string           `json:"blockId"`
	Summary       string            `json:"summary"`
	Target        *anchorTargetView `json:"target"`
}

type anchorTargetView struct {
	Kind  string `json:"kind"`
	Href  string `json:"href"`
	Label string `json:"label"`
}

func toAnchorView(anchor chain.Anchor) anchorView {
	view := anchorView{
		ID: anchor.ID, SubjectHash: anchor.SubjectHash, Source: anchor.Source,
		SubjectRef: anchor.SubjectRef, Label: anchor.Label, Metadata: anchor.Metadata,
		SiteKeyID: anchor.SiteKeyID, SitePublicKey: anchor.SitePublicKey,
		SiteSignature: anchor.SiteSignature, CreatedAt: anchor.CreatedAt,
	}
	if anchor.Metadata == nil {
		view.Metadata = map[string]any{}
	}
	if anchor.BlockID == "" {
		view.Status = "pending"
	} else {
		view.Status = "anchored"
		view.BlockID = &anchor.BlockID
	}
	return view
}

// enrichAnchorViews fills Summary/Target for every view. The chain package is
// deliberately payload-agnostic; the handler owns the business semantics here
// (docs/chain.md §2 boundary rule 1), reading only what a live row can answer.
func (h *apiHandler) enrichAnchorViews(ctx context.Context, views []anchorView) []anchorView {
	if len(views) == 0 {
		return views
	}
	commentIDs := make([]string, 0, len(views))
	contentIDs := make([]string, 0, len(views))
	for _, view := range views {
		if view.Source == chain.SourceComment && view.SubjectRef != "" {
			commentIDs = append(commentIDs, view.SubjectRef)
		}
		if id, ok := metadataString(view.Metadata, "contentId"); ok && (view.Source == chain.SourceReaction) {
			contentIDs = append(contentIDs, id)
		}
	}
	commentContent := map[string]string{}
	if len(commentIDs) > 0 {
		if resolved, err := h.store.CommentContentIDs(ctx, commentIDs); err == nil {
			commentContent = resolved
			for _, contentID := range resolved {
				contentIDs = append(contentIDs, contentID)
			}
		}
	}
	contentInfo := map[string]struct{ Slug, Kind string }{}
	if len(contentIDs) > 0 {
		if resolved, err := h.store.ChainContentTargets(ctx, contentIDs); err == nil {
			for id, target := range resolved {
				contentInfo[id] = struct{ Slug, Kind string }{Slug: target.Slug, Kind: string(target.Kind)}
			}
		}
	}
	for index := range views {
		views[index].Summary = anchorSummary(views[index])
		views[index].Target = anchorTarget(views[index], commentContent, contentInfo)
	}
	return views
}

// anchorSummary renders a short human description of what a certificate
// commits to, derived from source + metadata (never from the hashed payload).
func anchorSummary(view anchorView) string {
	switch view.Source {
	case chain.SourceContent:
		kind, _ := metadataString(view.Metadata, "kind")
		slug, _ := metadataString(view.Metadata, "slug")
		status, _ := metadataString(view.Metadata, "status")
		version, _ := metadataString(view.Metadata, "version")
		name := "Content"
		if kind == "ARTICLE" {
			name = "Writing"
		} else if kind == "THOUGHT" {
			name = "Thought"
		}
		label := slug
		if label == "" {
			label = "content"
		}
		state := strings.ToLower(status)
		if state == "" {
			state = "updated"
		}
		if version != "" {
			return name + " “" + label + "” · " + state + " · v" + version
		}
		return name + " “" + label + "” · " + state
	case chain.SourceComment:
		return "Comment " + commentActionLabel(view.Metadata)
	case chain.SourceReaction:
		action, _ := metadataString(view.Metadata, "action")
		if action == "removed" {
			return "Like removed"
		}
		return "Like added"
	case chain.SourceMedia:
		action, _ := metadataString(view.Metadata, "action")
		if action == "deleted" {
			return "Media deleted"
		}
		return "Media uploaded"
	case chain.SourceProfile:
		return "Profile updated"
	case chain.SourceSite:
		if target, _ := metadataString(view.Metadata, "target"); target == "pins" {
			return "Pinned content updated"
		}
		return "Site updated"
	case chain.SourceAuth:
		return authActionLabel(view.Metadata)
	case chain.SourceVisitor:
		if view.Label != "" {
			return "Public commitment · “" + view.Label + "”"
		}
		return "Public commitment"
	default: // admin
		if view.Label != "" {
			return "Admin commitment · “" + view.Label + "”"
		}
		return "Admin commitment"
	}
}

// anchorTarget resolves where the subject of an anchor lives, if anywhere.
func anchorTarget(view anchorView, commentContent map[string]string, contentInfo map[string]struct{ Slug, Kind string }) *anchorTargetView {
	switch view.Source {
	case chain.SourceContent:
		kind, _ := metadataString(view.Metadata, "kind")
		slug, _ := metadataString(view.Metadata, "slug")
		if slug == "" {
			return nil
		}
		route := "/thoughts/"
		label := "Thought “" + slug + "”"
		if kind == "ARTICLE" {
			route = "/writing/"
			label = "Writing “" + slug + "”"
		}
		return &anchorTargetView{Kind: "content", Href: route + slug, Label: label}
	case chain.SourceComment:
		contentID, ok := commentContent[view.SubjectRef]
		if !ok {
			return nil
		}
		info, ok := contentInfo[contentID]
		if !ok || info.Slug == "" {
			return nil
		}
		route := "/thoughts/"
		label := "Comments on “" + info.Slug + "”"
		if info.Kind == "ARTICLE" {
			route = "/writing/"
		}
		return &anchorTargetView{Kind: "comment", Href: route + info.Slug + "#comments", Label: label}
	case chain.SourceReaction:
		contentID, ok := metadataString(view.Metadata, "contentId")
		if !ok {
			return nil
		}
		info, ok := contentInfo[contentID]
		if !ok || info.Slug == "" {
			return nil
		}
		route := "/thoughts/"
		if info.Kind == "ARTICLE" {
			route = "/writing/"
		}
		return &anchorTargetView{Kind: "content", Href: route + info.Slug, Label: "“" + info.Slug + "”"}
	case chain.SourceMedia:
		mediaID, ok := metadataString(view.Metadata, "mediaId")
		if !ok || mediaID == "" {
			return nil
		}
		return &anchorTargetView{Kind: "media", Href: "/api/v1/media/" + mediaID, Label: "Open media"}
	default:
		return nil
	}
}

func commentActionLabel(metadata map[string]any) string {
	action, _ := metadataString(metadata, "action")
	switch action {
	case "created":
		return "created"
	case "hidden":
		return "hidden"
	case "unhidden":
		return "unhidden"
	case "deleted":
		return "deleted"
	case "restored":
		return "restored"
	case "author-updated":
		return "author updated"
	default:
		if action == "" {
			return "updated"
		}
		return action
	}
}

func authActionLabel(metadata map[string]any) string {
	action, _ := metadataString(metadata, "action")
	switch action {
	case "login":
		return "Sign-in"
	case "logout":
		return "Sign-out"
	case "logout-all":
		return "Sign-out (all sessions)"
	case "logout-by-id":
		return "Session revoked"
	case "password-changed":
		return "Password changed"
	default:
		if action == "" {
			return "Auth event"
		}
		return "Auth · " + action
	}
}

func metadataString(metadata map[string]any, key string) (string, bool) {
	value, ok := metadata[key]
	if !ok || value == nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	default:
		return "", false
	}
}
