package handler

import (
	"log/slog"
	"net/http"
	"sort"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

// anchorBusinessChange commits a change certificate after a successful
// business write. Chain failures never fail the business request: they
// surface as audit events and error logs (docs/chain.md §2 rule 3). A nil
// ledger (tests and legacy wiring) makes anchoring a no-op.
func (h *apiHandler) anchorBusinessChange(r *http.Request, source string, payload []byte, label, subjectRef string, metadata map[string]any) {
	if h.ledger == nil {
		return
	}
	anchor, err := h.ledger.Submit(source, payload, label, subjectRef, metadata)
	if err != nil {
		slog.Error("chain_anchor_failed", "source", source, "error", err)
		if h.auditEvents != nil {
			h.audit(r, "chain.anchor.failed", source, "", map[string]string{"error": err.Error()})
		}
		return
	}
	if h.auditEvents != nil {
		h.audit(r, "chain.anchor.submitted", source, anchor.ID, nil)
	}
}

// ContentPayload projects a content row into the canonical substance bytes
// plus its certificate metadata (docs/chain.md §4.1). Only editor-owned
// metadata participates: derived readingMinutes/toc are excluded so the
// substance hash stays identical across lifecycle flips. The subject ref is
// the contentId — the stable identifier across slug and status changes.
func ContentPayload(c model.Content) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	editorial := map[string]any{}
	switch metadata := c.Metadata.(type) {
	case model.ThoughtMetadata:
		editorial["mood"] = nullable(metadata.Mood)
		editorial["question"] = nullable(metadata.Question)
		editorial["context"] = nullable(metadata.Context)
		editorial["source"] = nullable(metadata.Source)
	case model.ArticleMetadata:
		editorial["language"] = nullable(metadata.Language)
		editorial["aiAssisted"] = metadata.AiAssisted
	}
	tags := append([]string(nil), c.Tags...)
	sort.Strings(tags)
	canonical, err := chain.CanonicalJSON(map[string]any{
		"kind":     string(c.Kind),
		"slug":     c.Slug,
		"title":    nullable(c.Title),
		"summary":  c.Summary,
		"body":     c.Body,
		"tags":     tags,
		"metadata": editorial,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", c.ID, map[string]any{
		"contentId": c.ID, "kind": string(c.Kind), "status": string(c.Status), "version": c.Version, "slug": c.Slug,
	}, nil
}

// CommentPayload projects a comment row: the substance the visitor wrote,
// taken from the post-write row (docs/chain.md §4.1 comment source). The
// subject ref is the commentId — contentId stays in metadata only.
func CommentPayload(c model.Comment, action string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	payload, err = commentPayload(c, true)
	if err != nil {
		return nil, "", "", nil, err
	}
	return payload, "", c.ID, map[string]any{"commentId": c.ID, "contentId": c.ContentID, "action": action}, nil
}

func legacyCommentPayload(c model.Comment) ([]byte, error) {
	return commentPayload(c, false)
}

func commentPayloadHashes(c model.Comment) ([]string, error) {
	current, _, _, _, err := CommentPayload(c, "created")
	if err != nil {
		return nil, err
	}
	legacy, err := legacyCommentPayload(c)
	if err != nil {
		return nil, err
	}
	return []string{chain.SubjectHashHex(current), chain.SubjectHashHex(legacy)}, nil
}

func commentPayload(c model.Comment, includeAvatar bool) ([]byte, error) {
	fields := map[string]any{
		"contentId":      c.ContentID,
		"authorName":     c.AuthorName,
		"authorUrl":      nullable(c.AuthorURL),
		"authorProvider": c.AuthorProvider,
		"body":           c.Body,
		"replyToId":      nullable(c.ReplyToID),
		"avatarSeed":     c.AvatarSeed,
	}
	if includeAvatar {
		fields["authorAvatarUrl"] = c.AuthorAvatarURL
	}
	canonical, err := chain.CanonicalJSON(fields)
	return []byte(canonical), err
}

// ReactionActionPayload describes a like mutation. Likes have no durable
// row projection in the API, so the certificate commits the action itself;
// repeated idempotent requests also become certificates (docs/chain.md §4.1).
// Reaction certs carry no stable ref.
func ReactionActionPayload(contentID, visitorID, action string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"contentId": contentID, "visitorId": visitorID, "action": action,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", "", map[string]any{"contentId": contentID, "action": action}, nil
}

// ProfilePayload commits the submitted ProfileInput as-is; the singleton row
// is referenced as profile_1 (docs/chain.md §4.1).
func ProfilePayload(input model.Profile) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"displayName": input.DisplayName, "handle": input.Handle, "headline": input.Headline,
		"bio": input.Bio, "avatarUrl": input.AvatarURL, "location": input.Location,
		"organization": input.Organization, "websiteUrl": input.WebsiteURL,
		"resumeUrl": nullable(input.ResumeURL), "interests": input.Interests,
		"education": input.Education, "experience": input.Experience,
		"series": input.Series, "contacts": input.Contacts,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", "profile_1", map[string]any{}, nil
}

// SitePayload commits the submitted site configuration as-is; the singleton
// row is referenced as site_1 (docs/chain.md §4.1).
func SitePayload(input model.SiteConfig) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"title": input.Title, "description": input.Description, "footer": input.Footer,
		"social": input.Social, "commentsEnabled": input.CommentsEnabled,
		"navigation": input.Navigation, "sections": input.Sections,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", "site_1", map[string]any{"target": "site"}, nil
}

// PinsPayload commits a whole-set pin replacement; each kind's config row is
// referenced as thoughts_1 / writings_1 (docs/chain.md §4.1).
func PinsPayload(kind model.ContentKind, pinnedIds []string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	ids := append([]string(nil), pinnedIds...)
	canonical, err := chain.CanonicalJSON(map[string]any{"kind": string(kind), "pinnedIds": ids})
	if err != nil {
		return nil, "", "", nil, err
	}
	target := "thoughts_1"
	if kind == model.ContentKindArticle {
		target = "writings_1"
	}
	return []byte(canonical), "", target, map[string]any{"target": "pins", "kind": string(kind), "configId": target}, nil
}

// MediaUploadPayload commits upload facts only; the blob itself never enters
// the certificate. The media row is referenced by its id.
func MediaUploadPayload(mediaID, mime string, size int64, shaHex, filename string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"mime": mime, "size": size, "sha256": shaHex, "filename": filename,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", mediaID, map[string]any{"mediaId": mediaID, "action": "uploaded"}, nil
}

// MediaDeletePayload describes a hard media delete.
func MediaDeletePayload(mediaID string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"mediaId": mediaID, "action": "deleted"})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", mediaID, map[string]any{"mediaId": mediaID, "action": "deleted"}, nil
}

// AuthActionPayload describes an auth lifecycle event. It never carries
// password material or session tokens (docs/chain.md §4.1 auth source);
// auth certs carry no stable ref.
func AuthActionPayload(username, action, sessionID string) (payload []byte, label, subjectRef string, metadata map[string]any, err error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"username": username, "action": action})
	if err != nil {
		return nil, "", "", nil, err
	}
	metadata = map[string]any{}
	if sessionID != "" {
		metadata["sessionId"] = sessionID
	}
	return []byte(canonical), "", "", metadata, nil
}

// nullable converts an optional pointer to nil for canonical JSON, so absent
// values hash uniformly instead of depending on nil-vs-omitted encoding.
func nullable[T any](value *T) any {
	if value == nil {
		return nil
	}
	return *value
}
