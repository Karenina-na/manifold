package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func timeNowUTC() time.Time { return time.Now().UTC() }

func (s *Store) RecordAuditEvent(eventName, resourceType, resourceID, actor string, requestID, traceID *string, metadata map[string]string) error {
	if metadata == nil {
		metadata = map[string]string{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO audit_events (id, event_name, resource_type, resource_id, actor, request_id, trace_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, newID("audit"), eventName, resourceType, resourceID, actor, requestID, traceID, string(raw), nowRFC3339())
	return err
}

func (s *Store) AuditEventCount() (int, error) {
	var count int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM audit_events`).Scan(&count)
	return count, err
}

const overviewTrendMonths = 12

func (s *Store) Overview() (model.AdminOverview, error) {
	overview := model.AdminOverview{Trend: model.AdminOverviewTrend{Monthly: []model.AdminOverviewTrendPoint{}}, TopContent: []model.AdminOverviewContentItem{}, Tags: []model.TagSummary{}}
	cutoff := timeNowUTC().Add(-presenceTTL).Format(time.RFC3339)
	var content model.AdminOverviewContent
	err := s.DB.QueryRow(`SELECT
		(SELECT COUNT(*) FROM content WHERE status = 'PUBLISHED'),
		(SELECT COUNT(*) FROM content WHERE status = 'DRAFT'),
		(SELECT COUNT(*) FROM content WHERE status = 'PUBLISHED' AND kind = 'ARTICLE'),
		(SELECT COUNT(*) FROM content WHERE status = 'PUBLISHED' AND kind = 'THOUGHT'),
		(SELECT COALESCE(SUM(view_count), 0) FROM content WHERE status != 'DELETED'),
		(SELECT COALESCE(SUM(like_count), 0) FROM content WHERE status != 'DELETED'),
		(SELECT COALESCE(SUM(comment_count), 0) FROM content WHERE status != 'DELETED'),
		(SELECT COUNT(*) FROM presence WHERE last_seen_at >= ?)`, cutoff).Scan(&content.ContentCount, &content.DraftCount, &content.ArticleCount, &content.ThoughtCount, &content.TotalViews, &content.TotalLikes, &content.TotalComments, &content.ActiveVisitors)
	if err != nil {
		return overview, err
	}
	overview.Content = content
	overview.Content.WordCount = 0
	rows, err := s.DB.Query(`SELECT body FROM content WHERE status = 'PUBLISHED'`)
	if err != nil {
		return overview, err
	}
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			_ = rows.Close()
			return overview, err
		}
		overview.Content.WordCount += countWords(body)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return overview, err
	}
	if err := rows.Close(); err != nil {
		return overview, err
	}

	now := timeNowUTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -(overviewTrendMonths - 1), 0)
	createdBy, err := s.monthlyCounts(`SELECT strftime('%Y-%m', created_at), COUNT(*) FROM content WHERE status != 'DELETED' AND created_at >= ? GROUP BY 1`, monthStart.Format("2006-01-02"))
	if err != nil {
		return overview, err
	}
	publishedBy, err := s.monthlyCounts(`SELECT strftime('%Y-%m', published_at), COUNT(*) FROM content WHERE status = 'PUBLISHED' AND published_at IS NOT NULL AND published_at >= ? GROUP BY 1`, monthStart.Format("2006-01-02"))
	if err != nil {
		return overview, err
	}
	for i := 0; i < overviewTrendMonths; i++ {
		month := monthStart.AddDate(0, i, 0).Format("2006-01")
		overview.Trend.Monthly = append(overview.Trend.Monthly, model.AdminOverviewTrendPoint{Month: month, Created: createdBy[month], Published: publishedBy[month]})
	}

	overview.TopContent, err = s.topPublishedContent(5)
	if err != nil {
		return overview, err
	}
	tags, err := s.Tags("")
	if err != nil {
		return overview, err
	}
	if len(tags) > 10 {
		tags = tags[:10]
	}
	overview.Tags = tags
	return overview, nil
}

func (s *Store) monthlyCounts(query, from string) (map[string]int, error) {
	rows, err := s.DB.Query(query, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var month string
		var count int
		if err := rows.Scan(&month, &count); err != nil {
			return nil, err
		}
		counts[month] = count
	}
	return counts, rows.Err()
}

func (s *Store) topPublishedContent(limit int) ([]model.AdminOverviewContentItem, error) {
	rows, err := s.DB.Query(`SELECT id, kind, slug, title, view_count, like_count, comment_count FROM content WHERE status = 'PUBLISHED' ORDER BY view_count DESC, id ASC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.AdminOverviewContentItem{}
	for rows.Next() {
		var item model.AdminOverviewContentItem
		var title sql.NullString
		if err := rows.Scan(&item.ID, &item.Kind, &item.Slug, &title, &item.ViewCount, &item.LikeCount, &item.CommentCount); err != nil {
			return nil, err
		}
		if title.Valid {
			item.Title = &title.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const maxAnalyticsDays = 90

func (s *Store) AnalyticsViews(days int) (model.AnalyticsViews, error) {
	if days <= 0 {
		days = 30
	}
	if days > maxAnalyticsDays {
		days = maxAnalyticsDays
	}
	today := timeNowUTC()
	views := model.AnalyticsViews{Range: model.AnalyticsRange{Days: days, From: today.AddDate(0, 0, -(days - 1)).Format("2006-01-02"), To: today.Format("2006-01-02")}, Daily: []model.AnalyticsDay{}, Referrers: []model.AnalyticsReferrer{}}
	if err := s.DB.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT CASE WHEN visitor_id != '' THEN visitor_id END) FROM content_view_events WHERE day >= ?`, views.Range.From).Scan(&views.TotalViews, &views.UniqueVisitors); err != nil {
		return views, err
	}
	byDay, err := s.viewEventDaily(views.Range.From)
	if err != nil {
		return views, err
	}
	for i := 0; i < days; i++ {
		date := today.AddDate(0, 0, -(days - 1 - i)).Format("2006-01-02")
		if day, ok := byDay[date]; ok {
			views.Daily = append(views.Daily, day)
			continue
		}
		views.Daily = append(views.Daily, model.AnalyticsDay{Date: date})
	}
	views.Referrers, err = s.viewEventReferrers(views.Range.From, 10)
	return views, err
}

func (s *Store) viewEventDaily(from string) (map[string]model.AnalyticsDay, error) {
	rows, err := s.DB.Query(`SELECT day, COUNT(*), COUNT(DISTINCT CASE WHEN visitor_id != '' THEN visitor_id END) FROM content_view_events WHERE day >= ? GROUP BY day`, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := map[string]model.AnalyticsDay{}
	for rows.Next() {
		var day model.AnalyticsDay
		if err := rows.Scan(&day.Date, &day.Views, &day.UniqueVisitors); err != nil {
			return nil, err
		}
		days[day.Date] = day
	}
	return days, rows.Err()
}

func (s *Store) viewEventReferrers(from string, limit int) ([]model.AnalyticsReferrer, error) {
	rows, err := s.DB.Query(`SELECT CASE WHEN referrer = '' THEN 'direct' ELSE referrer END, COUNT(*) FROM content_view_events WHERE day >= ? GROUP BY 1 ORDER BY COUNT(*) DESC, 1 ASC LIMIT ?`, from, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	referrers := []model.AnalyticsReferrer{}
	for rows.Next() {
		var referrer model.AnalyticsReferrer
		if err := rows.Scan(&referrer.Source, &referrer.Count); err != nil {
			return nil, err
		}
		referrers = append(referrers, referrer)
	}
	return referrers, rows.Err()
}

// ListAuditEvents returns one page of recent audit events, newest first.
// The needle filters by event name, actor, or resource id.
func (s *Store) ListAuditEvents(page, pageSize int, needle string) ([]model.AuditEvent, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 50 {
		pageSize = 50
	}
	filter := `WHERE (? = '' OR event_name LIKE '%' || ? || '%' OR actor LIKE '%' || ? || '%' OR resource_id LIKE '%' || ? || '%')`
	args := []any{needle, needle, needle, needle}
	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM audit_events `+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	page, _ = clampPagination(page, pageSize, total)
	offset := (page - 1) * pageSize
	rows, err := s.DB.Query(`SELECT id, event_name, resource_type, resource_id, actor, request_id, trace_id, metadata_json, created_at FROM audit_events `+filter+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
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

func (s *Store) DatabaseSizeBytes() (int64, error) {
	var pageCount, pageSize int64
	if err := s.DB.QueryRow(`PRAGMA page_count`).Scan(&pageCount); err != nil {
		return 0, err
	}
	if err := s.DB.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return 0, err
	}
	return pageCount * pageSize, nil
}
