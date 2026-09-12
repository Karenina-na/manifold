package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) RecordAuditEvent(ctx context.Context, eventName, resourceType, resourceID, actor string, requestID, traceID *string, metadata map[string]string) error {
	if metadata == nil {
		metadata = map[string]string{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO audit_events (id, event_name, resource_type, resource_id, actor, request_id, trace_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, newID("audit"), eventName, resourceType, resourceID, actor, requestID, traceID, string(raw), nowRFC3339())
	return err
}

func (s *Store) AuditEventCount(ctx context.Context) (int, error) {
	var count int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_events`).Scan(&count)
	return count, err
}

// ListAuditEvents returns one page of recent audit events, newest first.
// The needle filters by event name, actor, or resource id.
func (s *Store) ListAuditEvents(ctx context.Context, page, pageSize int, needle string) ([]model.AuditEvent, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 50 {
		pageSize = 50
	}
	filter := `WHERE (? = '' OR event_name LIKE ? ESCAPE '\' OR actor LIKE ? ESCAPE '\' OR resource_id LIKE ? ESCAPE '\')`
	args := []any{needle, likePattern(needle), likePattern(needle), likePattern(needle)}
	var total int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_events `+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	page, _ = clampPagination(page, pageSize, total)
	offset := (page - 1) * pageSize
	rows, err := s.DB.QueryContext(ctx, `SELECT id, event_name, resource_type, resource_id, actor, request_id, trace_id, metadata_json, created_at FROM audit_events `+filter+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	events := []model.AuditEvent{}
	for rows.Next() {
		var event model.AuditEvent
		var requestID, traceID sql.NullString
		if err := rows.Scan(&event.ID, &event.EventName, &event.ResourceType, &event.ResourceID, &event.Actor, &requestID, &traceID, &event.MetadataJSON, &event.CreatedAt); err != nil {
			return nil, 0, err
		}
		if requestID.Valid {
			event.RequestID = &requestID.String
		}
		if traceID.Valid {
			event.TraceID = &traceID.String
		}
		events = append(events, event)
	}
	return events, total, rows.Err()
}
