package application

import (
	"log/slog"
	"strconv"

	"github.com/manifold-space/manifold/app/core/internal/cache"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type Request struct {
	Actor     string
	RequestID *string
	TraceID   *string
}

type Service struct {
	store         *store.Store
	ledger        *chain.Ledger
	auditEvents   events.AuditPublisher
	contentCache  *cache.ContentCache
	statsCache    *cache.StatsCache
	overviewCache *cache.OverviewCache
}

func NewService(database *store.Store, ledger *chain.Ledger, auditEvents events.AuditPublisher, contentCache *cache.ContentCache, statsCache *cache.StatsCache, overviewCache *cache.OverviewCache) *Service {
	return &Service{store: database, ledger: ledger, auditEvents: auditEvents, contentCache: contentCache, statsCache: statsCache, overviewCache: overviewCache}
}

func (s *Service) audit(request Request, eventName, resourceType, resourceID string, metadata map[string]string) {
	if s.auditEvents == nil {
		return
	}
	if !s.auditEvents.Publish(events.AuditEvent{EventName: eventName, ResourceType: resourceType, ResourceID: resourceID, Actor: request.Actor, RequestID: request.RequestID, TraceID: request.TraceID, Metadata: metadata}) {
		slog.Warn("audit_event_dropped", "eventName", eventName, "resourceType", resourceType, "resourceId", resourceID)
	}
}

func (s *Service) anchor(request Request, source string, payload []byte, label, subjectRef string, metadata map[string]any) {
	if s.ledger == nil {
		return
	}
	anchor, err := s.ledger.Submit(source, payload, label, subjectRef, metadata)
	if err != nil {
		slog.Error("chain_anchor_failed", "source", source, "error", err)
		s.audit(request, "chain.anchor.failed", source, "", map[string]string{"error": err.Error()})
		return
	}
	s.audit(request, "chain.anchor.submitted", source, anchor.ID, nil)
}

func (s *Service) invalidateContent(slugs ...string) {
	s.statsCache.Purge()
	s.overviewCache.Purge()
	for _, slug := range slugs {
		s.contentCache.Remove(slug)
	}
}

func (s *Service) CreateContent(request Request, input model.ContentInput) (model.Content, error) {
	content, err := s.store.CreateContent(input)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.created", "content", content.ID, map[string]string{"kind": string(content.Kind)})
	if payload, label, ref, metadata, err := ContentPayload(content); err == nil {
		s.anchor(request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return content, nil
}

func (s *Service) UpdateContent(request Request, current model.Content, input store.ContentUpdate) (model.Content, error) {
	if err := s.store.UpdateContent(current.ID, input); err != nil {
		return model.Content{}, err
	}
	updated, err := s.store.GetContentByID(current.ID, true)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.updated", "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(updated); err == nil {
		s.anchor(request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug, updated.Slug)
	return updated, nil
}

func (s *Service) SetContentStatus(request Request, current model.Content, status model.ContentStatus) (model.Content, error) {
	if err := s.store.SetContentStatus(current.ID, status); err != nil {
		return model.Content{}, err
	}
	updated, err := s.store.GetContentByID(current.ID, true)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content."+statusEvent(status), "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(updated); err == nil {
		s.anchor(request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug, updated.Slug)
	return updated, nil
}

func statusEvent(status model.ContentStatus) string {
	switch status {
	case model.StatusPublished:
		return "published"
	case model.StatusDraft:
		return "draft"
	default:
		return "deleted"
	}
}

func (s *Service) DeleteContent(request Request, current model.Content) error {
	deleted, err := s.store.DeleteContent(current.ID)
	if err != nil {
		return err
	}
	s.audit(request, "content.deleted", "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(deleted); err == nil {
		s.anchor(request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug)
	return nil
}

func (s *Service) RestoreContent(request Request, id string) (model.Content, error) {
	content, err := s.store.RestoreContent(id)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.restored", "content", content.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(content); err == nil {
		s.anchor(request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return content, nil
}

type CommentInput struct {
	AuthorName, Body, AvatarSeed, AuthorProvider, AuthorAvatarURL string
	AuthorURL, ReplyToID                                          *string
}

func (s *Service) CreateComment(request Request, content model.Content, input CommentInput) (model.Comment, error) {
	comment, err := s.store.CreateComment(content.ID, input.AuthorName, input.AuthorURL, input.Body, input.ReplyToID, input.AvatarSeed, input.AuthorProvider, input.AuthorAvatarURL)
	if err != nil {
		return model.Comment{}, err
	}
	s.audit(request, "comment.created", "comment", comment.ID, map[string]string{"contentId": content.ID})
	if payload, label, ref, metadata, err := CommentPayload(comment, "created"); err == nil {
		s.anchor(request, chain.SourceComment, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return comment, nil
}

func (s *Service) SetCommentHidden(request Request, id string, hidden bool) error {
	var contentID string
	var err error
	action := "hidden"
	if hidden {
		contentID, err = s.store.HideComment(id)
	} else {
		contentID, err = s.store.UnhideComment(id)
		action = "unhidden"
	}
	if err != nil {
		return err
	}
	s.afterCommentChange(request, id, contentID, action)
	return nil
}

func (s *Service) SetCommentDeleted(request Request, id string, deleted bool) error {
	var contentID string
	var err error
	action := "deleted"
	if deleted {
		contentID, err = s.store.SoftDeleteComment(id)
	} else {
		contentID, err = s.store.RestoreComment(id)
		action = "restored"
	}
	if err != nil {
		return err
	}
	s.afterCommentChange(request, id, contentID, action)
	return nil
}

func (s *Service) UpdateCommentAuthor(request Request, id string, update store.CommentAuthorUpdate) error {
	contentID, err := s.store.UpdateCommentAuthor(id, update)
	if err != nil {
		return err
	}
	s.audit(request, "comment.updated", "comment", id, nil)
	s.anchorComment(request, id, "author-updated")
	s.invalidateCommentContent(contentID)
	return nil
}

func (s *Service) afterCommentChange(request Request, id, contentID, action string) {
	s.audit(request, "comment."+action, "comment", id, nil)
	s.anchorComment(request, id, action)
	s.invalidateCommentContent(contentID)
}

func (s *Service) anchorComment(request Request, id, action string) {
	comment, err := s.store.GetCommentByID(id)
	if err != nil {
		return
	}
	if payload, label, ref, metadata, err := CommentPayload(comment.Comment, action); err == nil {
		s.anchor(request, chain.SourceComment, payload, label, ref, metadata)
	}
}

func (s *Service) invalidateCommentContent(contentID string) {
	if content, err := s.store.GetContentByID(contentID, true); err == nil {
		s.invalidateContent(content.Slug)
	} else {
		s.overviewCache.Purge()
	}
}

func (s *Service) SetLike(request Request, content model.Content, visitorID string, enabled bool) error {
	action := "removed"
	var err error
	if enabled {
		err = s.store.SetLike(content.ID, visitorID)
		action = "added"
	} else {
		err = s.store.DeleteLike(content.ID, visitorID)
	}
	if err != nil {
		return err
	}
	s.audit(request, "content.like."+action, "content", content.ID, nil)
	if payload, label, ref, metadata, err := ReactionActionPayload(content.ID, visitorID, action); err == nil {
		s.anchor(request, chain.SourceReaction, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return nil
}

func (s *Service) UpdateProfile(request Request, profile model.Profile) error {
	if err := s.store.UpdateProfile(profile); err != nil {
		return err
	}
	s.audit(request, "profile.updated", "profile", "profile_1", nil)
	if payload, label, ref, metadata, err := ProfilePayload(profile); err == nil {
		s.anchor(request, chain.SourceProfile, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) UpdateSite(request Request, config model.SiteConfig) error {
	if err := s.store.UpdateSiteConfig(config); err != nil {
		return err
	}
	s.audit(request, "site.updated", "site", "site_1", nil)
	if payload, label, ref, metadata, err := SitePayload(config); err == nil {
		s.anchor(request, chain.SourceSite, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) SetPinnedIDs(request Request, kind model.ContentKind, ids []string) error {
	if err := s.store.SetPinnedIds(kind, ids); err != nil {
		return err
	}
	resourceType, resourceID, eventName := "thoughts_config", "thoughts_1", "thoughts.config.updated"
	if kind == model.ContentKindArticle {
		resourceType, resourceID, eventName = "writings_config", "writings_1", "writings.config.updated"
	}
	s.audit(request, eventName, resourceType, resourceID, nil)
	if payload, label, ref, metadata, err := PinsPayload(kind, ids); err == nil {
		s.anchor(request, chain.SourceSite, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) InsertMedia(request Request, mime, filename, shaHex string, data []byte) (model.Media, bool, error) {
	media, created, err := s.store.InsertMedia(mime, filename, shaHex, data)
	if err != nil || !created {
		return media, created, err
	}
	s.audit(request, "media.uploaded", "media", media.ID, map[string]string{"mime": media.Mime, "size": strconv.FormatInt(media.Size, 10), "sha256": shaHex})
	if payload, label, ref, metadata, err := MediaUploadPayload(media.ID, media.Mime, media.Size, shaHex, media.Filename); err == nil {
		s.anchor(request, chain.SourceMedia, payload, label, ref, metadata)
	}
	return media, true, nil
}

func (s *Service) DeleteMedia(request Request, id string) error {
	if err := s.store.DeleteMedia(id); err != nil {
		return err
	}
	s.audit(request, "media.deleted", "media", id, nil)
	if payload, label, ref, metadata, err := MediaDeletePayload(id); err == nil {
		s.anchor(request, chain.SourceMedia, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) RecordAuthChange(request Request, username, action, sessionID string) {
	eventName, resourceType, resourceID := authAudit(action, username, sessionID)
	s.audit(request, eventName, resourceType, resourceID, nil)
	if payload, label, ref, metadata, err := AuthActionPayload(username, action, sessionID); err == nil {
		s.anchor(request, chain.SourceAuth, payload, label, ref, metadata)
	}
}

func authAudit(action, username, sessionID string) (string, string, string) {
	switch action {
	case "login":
		return "admin.session.created", "session", username
	case "logout":
		return "admin.session.revoked", "session", sessionID
	case "logout-all":
		return "admin.sessions.revoked_all", "session", username
	case "password-changed":
		return "admin.password.changed", "password", username
	default:
		return "admin.session.revoked", "session", sessionID
	}
}
