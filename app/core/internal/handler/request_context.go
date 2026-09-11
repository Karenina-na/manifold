package handler

import (
	"log/slog"
	"net/http"

	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/events"
)

func (h *apiHandler) audit(r *http.Request, eventName, resourceType, resourceID string, metadata map[string]string) {
	actor := "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil && claims.Subject != "" {
		actor = claims.Subject
	}
	requestID := headerPtr(r.Header.Get("X-Request-ID"))
	traceID := headerPtr(r.Header.Get("X-Trace-ID"))
	if !h.auditEvents.Publish(events.AuditEvent{EventName: eventName, ResourceType: resourceType, ResourceID: resourceID, Actor: actor, RequestID: requestID, TraceID: traceID, Metadata: metadata}) {
		slog.Warn("audit_event_dropped", "eventName", eventName, "resourceType", resourceType, "resourceId", resourceID)
	}
}

func mutationRequest(r *http.Request) application.Request {
	actor := "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil && claims.Subject != "" {
		actor = claims.Subject
	}
	return application.Request{Actor: actor, RequestID: headerPtr(r.Header.Get("X-Request-ID")), TraceID: headerPtr(r.Header.Get("X-Trace-ID"))}
}

func headerPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
