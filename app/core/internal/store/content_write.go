package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) replaceTags(ctx context.Context, tx *sql.Tx, contentID string, tags []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM content_tags WHERE content_id = ?`, contentID); err != nil {
		return err
	}
	for _, tag := range tags {
		if _, err := tx.ExecContext(ctx, `INSERT INTO content_tags (content_id, tag) VALUES (?, ?)`, contentID, tag); err != nil {
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

func (s *Store) CreateContent(ctx context.Context, input model.ContentInput) (model.Content, error) {
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
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return model.Content{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO content (id, kind, status, slug, title, summary, body, excerpt, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Kind, c.Status, c.Slug, c.Title, c.Summary, c.Body, c.Excerpt, encodeJSON(c.Metadata), now, now); err != nil {
		if isUniqueViolation(err) {
			return model.Content{}, ErrSlugTaken
		}
		return model.Content{}, err
	}
	c.Tags = normalizeTags(c.Tags)
	if err := s.replaceTags(ctx, tx, c.ID, c.Tags); err != nil {
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

func (s *Store) UpdateContent(ctx context.Context, id string, update ContentUpdate) error {
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
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `UPDATE content SET `+strings.Join(sets, ", ")+` WHERE id = ? AND status != 'DELETED' AND version = ?`, args...)
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
		return ErrVersionConflict
	}
	if err := s.replaceTags(ctx, tx, id, tags); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetContentStatus(ctx context.Context, id string, status model.ContentStatus) error {
	now := nowRFC3339()
	result, err := s.DB.ExecContext(ctx, `UPDATE content
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
	err = s.DB.QueryRowContext(ctx, `SELECT 1 FROM content WHERE id = ?`, id).Scan(&exists)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return ErrContentNotFound
}

func (s *Store) DeleteContent(ctx context.Context, id string) (model.Content, error) {
	if err := s.SetContentStatus(ctx, id, model.StatusDeleted); err != nil {
		return model.Content{}, err
	}
	return s.getContentByID(ctx, id, true)
}

func (s *Store) RestoreContent(ctx context.Context, id string) (model.Content, error) {
	result, err := s.DB.ExecContext(ctx, `UPDATE content SET status = 'DRAFT', version = version + 1, updated_at = ? WHERE id = ? AND status = 'DELETED'`, nowRFC3339(), id)
	if err != nil {
		return model.Content{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return model.Content{}, err
	}
	if count == 0 {
		if _, err := s.GetContentByID(ctx, id, true); errors.Is(err, ErrContentNotFound) {
			return model.Content{}, ErrContentNotFound
		}
		return model.Content{}, ErrVersionConflict
	}
	return s.GetContentByID(ctx, id, true)
}

func (s *Store) Stats(ctx context.Context) (model.Stats, error) {
	var stats model.Stats
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(kind = 'ARTICLE'), 0), COALESCE(SUM(kind = 'THOUGHT'), 0) FROM content WHERE status = 'PUBLISHED'`).Scan(&stats.ContentCount, &stats.ArticleCount, &stats.ThoughtCount)
	if err != nil {
		return stats, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT body FROM content WHERE status = 'PUBLISHED'`)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
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
