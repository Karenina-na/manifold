package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

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

// replaceTags rewrites the normalized tag rows for one content item.
func (s *Store) replaceTags(tx *sql.Tx, contentID string, tags []string) error {
	if _, err := tx.Exec(`DELETE FROM content_tags WHERE content_id = ?`, contentID); err != nil {
		return err
	}
	for _, tag := range tags {
		if _, err := tx.Exec(`INSERT INTO content_tags (content_id, tag) VALUES (?, ?)`, contentID, tag); err != nil {
			return err
		}
	}
	return nil
}

func normalizeTags(tags []string) []string {
	result := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, raw := range tags {
		tag := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return result
}

func validateTags(tags []string) error {
	if len(tags) > 10 {
		return errors.New("too many tags")
	}
	for _, raw := range tags {
		canonical := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
		if canonical == "" || utf8.RuneCountInString(canonical) > 80 {
			return errors.New("tags must be 1-80 characters")
		}
	}
	return nil
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
		query += ` AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(body) LIKE ?)`
		term := "%" + strings.ToLower(options.Query) + "%"
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

// CreateContent persists a new draft row in one transaction, deriving the
// excerpt and article metadata from the body and materializing tag rows.
// EditorialMetadata is the client's raw JSON (already validated by the
// handler); derived fields in it are ignored in favor of body derivation.
func (s *Store) CreateContent(input model.ContentInput) (model.Content, error) {
	if strings.TrimSpace(input.Slug) == "" {
		return model.Content{}, fmt.Errorf("slug is required")
	}
	if err := validateTags(input.Tags); err != nil {
		return model.Content{}, err
	}
	now := nowRFC3339()
	c := model.Content{
		ID: newID("content"), Kind: input.Kind, Status: model.StatusDraft,
		Slug: input.Slug, Title: input.Title, Summary: input.Summary, Body: input.Body,
		Tags: input.Tags, CreatedAt: now, UpdatedAt: now, Version: 1,
		Excerpt: contentExcerpt(input.Body),
	}
	if c.Tags == nil {
		c.Tags = []string{}
	}
	metadata, err := model.NormalizeMetadataFor(input.Kind, input.Body, input.EditorialMetadata)
	if err != nil {
		return model.Content{}, err
	}
	c.Metadata = metadata
	tx, err := s.DB.Begin()
	if err != nil {
		return model.Content{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, excerpt, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Kind, c.Status, c.Slug, c.Title, c.Summary, c.Body, c.Excerpt, encodeJSON(c.Metadata), now, now); err != nil {
		if isUniqueViolation(err) {
			return model.Content{}, ErrSlugTaken
		}
		return model.Content{}, err
	}
	c.Tags = normalizeTags(c.Tags)
	if err := s.replaceTags(tx, c.ID, c.Tags); err != nil {
		return model.Content{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.Content{}, err
	}
	return c, nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// UpdateContent replaces the complete editable projection under optimistic
// locking. Derived excerpt and metadata are recomputed from the submitted body.
func (s *Store) UpdateContent(id string, update ContentUpdate) error {
	if update.Kind == nil || update.Slug == nil || update.Body == nil || update.Summary == nil || update.Tags == nil || !update.TitleSet {
		return errors.New("complete content update is required")
	}
	if err := validateTags(*update.Tags); err != nil {
		return err
	}
	if strings.TrimSpace(*update.Slug) == "" {
		return fmt.Errorf("slug is required")
	}
	metadata, err := model.NormalizeMetadataFor(*update.Kind, *update.Body, update.Metadata)
	if err != nil {
		return err
	}
	tags := normalizeTags(*update.Tags)
	sets := []string{"kind = ?", "slug = ?", "title = ?", "summary = ?", "body = ?", "excerpt = ?", "metadata_json = ?", "version = version + 1", "updated_at = ?"}
	args := []any{*update.Kind, *update.Slug, update.Title, *update.Summary, *update.Body, contentExcerpt(*update.Body), encodeJSON(metadata), nowRFC3339(), id, update.ExpectedVersion}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE content SET `+strings.Join(sets, ", ")+` WHERE id = ? AND status != 'DELETED' AND version = ?`, args...)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrSlugTaken
		}
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		// The row was loaded before the transaction. Since deleted rows are
		// excluded by that read, a zero-row update here is a version conflict.
		return ErrVersionConflict
	}
	if err := s.replaceTags(tx, id, tags); err != nil {
		return err
	}
	return tx.Commit()
}

// SetContentStatus transitions the lifecycle. published_at is an immutable
// first-publication fact: publishing only stamps it when NULL.
func (s *Store) SetContentStatus(id string, status model.ContentStatus) error {
	now := nowRFC3339()
	result, err := s.DB.Exec(`UPDATE content
		SET status = ?,
			published_at = CASE WHEN ? = 'PUBLISHED' AND published_at IS NULL THEN ? ELSE published_at END,
			version = version + 1,
			updated_at = ?
		WHERE id = ? AND status != 'DELETED'`, status, status, now, now, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	var exists int
	err = s.DB.QueryRow(`SELECT 1 FROM content WHERE id = ?`, id).Scan(&exists)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return ErrContentNotFound
}

// DeleteContent soft-deletes; RestoreContent returns the row to DRAFT. Both
// keep the like/comment counters consistent (restore re-counts).
func (s *Store) DeleteContent(id string) (model.Content, error) {
	if err := s.SetContentStatus(id, model.StatusDeleted); err != nil {
		return model.Content{}, err
	}
	return s.getContentByID(id, true)
}

func (s *Store) RestoreContent(id string) (model.Content, error) {
	result, err := s.DB.Exec(`UPDATE content SET status = 'DRAFT', version = version + 1, updated_at = ? WHERE id = ? AND status = 'DELETED'`, nowRFC3339(), id)
	if err != nil {
		return model.Content{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return model.Content{}, err
	}
	if count == 0 {
		if _, err := s.GetContentByID(id, true); errors.Is(err, ErrContentNotFound) {
			return model.Content{}, ErrContentNotFound
		}
		return model.Content{}, ErrVersionConflict
	}
	return s.GetContentByID(id, true)
}

func (s *Store) Stats() (model.Stats, error) {
	var stats model.Stats
	err := s.DB.QueryRow(`SELECT COUNT(*), COALESCE(SUM(kind = 'ARTICLE'), 0), COALESCE(SUM(kind = 'THOUGHT'), 0) FROM content WHERE status = 'PUBLISHED'`).Scan(&stats.ContentCount, &stats.ArticleCount, &stats.ThoughtCount)
	if err != nil {
		return stats, err
	}
	rows, err := s.DB.Query(`SELECT body FROM content WHERE status = 'PUBLISHED'`)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	stats.WordCount = 0
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return stats, err
		}
		stats.WordCount += countWords(body)
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	stats.UpdatedAt = nowRFC3339()
	return stats, nil
}
