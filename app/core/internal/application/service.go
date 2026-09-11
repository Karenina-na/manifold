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
