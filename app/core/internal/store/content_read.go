package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

// contentColumns is the single canonical projection for content rows. Every
// read path shares it so column/scan drift is impossible. Tag rows live in
// content_tags and are joined in via the aggregate subquery.
const contentColumns = `id, kind, status, slug, title, summary, body, excerpt, (SELECT json_group_array(content_tags.tag) FROM content_tags WHERE content_tags.content_id = content.id), metadata_json, published_at, created_at, updated_at, version, view_count, like_count, comment_count`

func scanContent(scanner interface{ Scan(dest ...any) error }) (model.Content, error) {
	var c model.Content
	var title, published sql.NullString
	var tags, metadata string
	if err := scanner.Scan(&c.ID, &c.Kind, &c.Status, &c.Slug, &title, &c.Summary, &c.Body, &c.Excerpt, &tags, &metadata, &published, &c.CreatedAt, &c.UpdatedAt, &c.Version, &c.ViewCount, &c.LikeCount, &c.CommentCount); err != nil {
		return model.Content{}, err
	}
	if title.Valid {
		c.Title = &title.String
	}
	if published.Valid {
		c.PublishedAt = &published.String
	}
	if err := json.Unmarshal([]byte(tags), &c.Tags); err != nil || c.Tags == nil {
		c.Tags = []string{}
	}
	normalized, err := model.NormalizeMetadataFor(c.Kind, c.Body, json.RawMessage(metadata))
	if err != nil {
		return model.Content{}, err
	}
	c.Metadata = normalized
	return c, nil
}

func (s *Store) scanContents(query string, args ...any) ([]model.Content, error) {
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Content{}
	for rows.Next() {
		item, err := scanContent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func contentListWhere(includeDrafts bool, options ContentListOptions) (string, []any) {
	query := `WHERE 1 = 1`
	args := make([]any, 0, 8)
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	} else if options.Status == "" {
		query += ` AND status != 'DELETED'`
	}
	if options.Status != "" {
		query += ` AND status = ?`
		args = append(args, options.Status)
	}
	if len(options.Kinds) > 0 {
		placeholders := make([]string, len(options.Kinds))
		for i, kind := range options.Kinds {
			placeholders[i] = "?"
			args = append(args, kind)
		}
		query += ` AND kind IN (` + strings.Join(placeholders, ",") + `)`
	}
	if len(options.Tags) > 0 {
		placeholders := make([]string, len(options.Tags))
		for i, tag := range options.Tags {
			placeholders[i] = "?"
			args = append(args, tag)
		}
		query += ` AND EXISTS (SELECT 1 FROM content_tags WHERE content_tags.content_id = content.id AND content_tags.tag IN (` + strings.Join(placeholders, ",") + `))`
	}
	if options.Query != "" {
		query += ` AND (LOWER(title) LIKE ? ESCAPE '\' OR LOWER(summary) LIKE ? ESCAPE '\' OR LOWER(body) LIKE ? ESCAPE '\')`
		term := likePattern(strings.ToLower(options.Query))
		args = append(args, term, term, term)
	}
	if options.AiAssisted != nil {
		query += ` AND COALESCE(json_extract(metadata_json, '$.aiAssisted'), 0) IN (1, 'true') = ?`
		args = append(args, *options.AiAssisted)
	}
	if options.PinnedIDsOnly {
		query += ` AND EXISTS (SELECT 1 FROM pins WHERE pins.content_id = content.id AND pins.kind = content.kind)`
	}
	return query, args
}

func contentSortClause(sort string) string {
	switch sort {
	case "oldest":
		return ` ORDER BY COALESCE(published_at, created_at) ASC, id ASC`
	case "updated":
		return ` ORDER BY updated_at DESC, id DESC`
	default:
		return ` ORDER BY COALESCE(published_at, created_at) DESC, id DESC`
	}
}

func clampPagination(page, pageSize, totalItems int) (int, int) {
	totalPages := (totalItems + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}
	return page, totalPages
}

// ListContent is the single listing query behind both the public and admin
// surfaces. includeDrafts selects the admin projection (all statuses unless a
// status filter narrows it).
func (s *Store) ListContent(includeDrafts bool, options ContentListOptions) (ContentListResult, error) {
	pageSize := options.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := options.Page
	if page < 1 {
		page = 1
	}
	where, args := contentListWhere(includeDrafts, options)
	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM content `+where, args...).Scan(&total); err != nil {
		return ContentListResult{}, err
	}
	page, totalPages := clampPagination(page, pageSize, total)
	items, err := s.scanContents(`SELECT `+contentColumns+` FROM content `+where+contentSortClause(options.Sort)+` LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return ContentListResult{}, err
	}
	if !includeDrafts {
		for i := range items {
			items[i].Body = ""
		}
	}
	return ContentListResult{Items: items, Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}, nil
}

// HomeTimeline returns the bounded public projection used by the homepage's
// chronological Updates rail. The query is intentionally separate from the
// general listing API so the homepage cannot request an unbounded history.
func (s *Store) HomeTimeline(limit int) ([]model.HomeTimelineItem, int, bool, error) {
	if limit <= 0 {
		limit = 1000
	}
	if limit > 1000 {
		limit = 1000
	}
	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM content WHERE status = 'PUBLISHED'`).Scan(&total); err != nil {
		return nil, 0, false, err
	}
	rows, err := s.DB.Query(`
		SELECT id, kind, slug, title, summary, published_at
		FROM (
			SELECT id, kind, slug, title, summary, published_at
			FROM content
			WHERE status = 'PUBLISHED'
			ORDER BY published_at DESC, id DESC
			LIMIT ?
		)
		ORDER BY published_at ASC, id ASC`, limit)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	items := make([]model.HomeTimelineItem, 0, min(limit, total))
	for rows.Next() {
		var item model.HomeTimelineItem
		if err := rows.Scan(&item.ID, &item.Kind, &item.Slug, &item.Title, &item.Summary, &item.PublishedAt); err != nil {
			return nil, 0, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	return items, total, total > len(items), nil
}

func (s *Store) Tags(kind model.ContentKind) ([]model.TagSummary, error) {
	query := `SELECT content_tags.tag, COUNT(*) FROM content_tags JOIN content ON content.id = content_tags.content_id WHERE content.status = 'PUBLISHED'`
	args := []any{}
	if kind != "" {
		query += ` AND content.kind = ?`
		args = append(args, kind)
	}
	query += ` GROUP BY content_tags.tag ORDER BY COUNT(*) DESC, content_tags.tag ASC`
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tags := []model.TagSummary{}
	for rows.Next() {
		var tag model.TagSummary
		if err := rows.Scan(&tag.Name, &tag.Count); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

// GetContentBySlug resolves a single published-or-draft (per includeDrafts)
// row strictly by slug.
func (s *Store) GetContentBySlug(slug string, includeDrafts bool) (model.Content, error) {
	query := `SELECT ` + contentColumns + ` FROM content WHERE slug = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	row := s.DB.QueryRow(query, slug)
	content, err := scanContent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Content{}, ErrContentNotFound
	}
	return content, err
}

// GetContentByID serves admin reads and pin resolution.
func (s *Store) GetContentByID(id string, includeDrafts bool) (model.Content, error) {
	query := `SELECT ` + contentColumns + ` FROM content WHERE id = ? AND status != 'DELETED'`
	if !includeDrafts {
		query += ` AND status = 'PUBLISHED'`
	}
	row := s.DB.QueryRow(query, id)
	content, err := scanContent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Content{}, ErrContentNotFound
	}
	return content, err
}

func (s *Store) getContentByID(id string, includeDeleted bool) (model.Content, error) {
	query := `SELECT ` + contentColumns + ` FROM content WHERE id = ?`
	if !includeDeleted {
		query += ` AND status != 'DELETED'`
	}
	content, err := scanContent(s.DB.QueryRow(query, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.Content{}, ErrContentNotFound
	}
	return content, err
}

// PinnedContent resolves the configured pins for a kind in display order
// (position, then pin time). Pins are explicit: an empty pin set returns nil.
func (s *Store) PinnedContent(kind model.ContentKind) ([]model.Content, error) {
	ids, err := s.GetPinnedIds(kind)
	if err != nil {
		return nil, err
	}
	items := make([]model.Content, 0, len(ids))
	for _, id := range ids {
		item, err := s.GetContentByID(id, false)
		if err != nil {
			if errors.Is(err, ErrContentNotFound) {
				continue
			}
			return nil, err
		}
		if item.Kind != kind {
			continue
		}
		item.Body = ""
		items = append(items, item)
	}
	return items, nil
}
