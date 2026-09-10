package store

import (
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

type ChainContentTarget struct {
	ID   string
	Slug string
	Kind model.ContentKind
}

func (s *Store) CommentContentIDs(ids []string) (map[string]string, error) {
	result := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.DB.Query(`SELECT id, content_id FROM comments WHERE id IN (`+queryPlaceholders(len(ids))+`)`, stringsToAny(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, contentID string
		if err := rows.Scan(&id, &contentID); err != nil {
			return nil, err
		}
		result[id] = contentID
	}
	return result, rows.Err()
}

func (s *Store) ChainContentTargets(ids []string) (map[string]ChainContentTarget, error) {
	result := make(map[string]ChainContentTarget, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.DB.Query(`SELECT id, slug, kind FROM content WHERE id IN (`+queryPlaceholders(len(ids))+`)`, stringsToAny(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var target ChainContentTarget
		if err := rows.Scan(&target.ID, &target.Slug, &target.Kind); err != nil {
			return nil, err
		}
		result[target.ID] = target
	}
	return result, rows.Err()
}

func (s *Store) PublishedContents() ([]model.Content, error) {
	return s.scanContents(`SELECT ` + contentColumns + ` FROM content WHERE status = 'PUBLISHED' ORDER BY id ASC`)
}

func queryPlaceholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}
