package application

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/chain"
)

func (s *Service) RecordAuthChange(ctx context.Context, request Request, username, action, sessionID string) {
	eventName, resourceType, resourceID := authAudit(action, username, sessionID)
	s.audit(request, eventName, resourceType, resourceID, nil)
	if payload, label, ref, metadata, err := AuthActionPayload(username, action, sessionID); err == nil {
		s.anchor(ctx, request, chain.SourceAuth, payload, label, ref, metadata)
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
