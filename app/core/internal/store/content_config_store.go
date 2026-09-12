package store

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetThoughtConfig(ctx context.Context) (model.ThoughtConfig, error) {
	var config model.ThoughtConfig
	err := s.DB.QueryRowContext(ctx, `SELECT updated_at FROM thoughts_config WHERE id = 'thoughts_1'`).Scan(&config.UpdatedAt)
	if err != nil {
		return model.ThoughtConfig{}, err
	}
	pinned, err := s.GetPinnedIds(ctx, model.ContentKindThought)
	if err != nil {
		return model.ThoughtConfig{}, err
	}
	config.PinnedIds = pinned
	return config, nil
}

func (s *Store) GetWritingConfig(ctx context.Context) (model.WritingConfig, error) {
	var config model.WritingConfig
	err := s.DB.QueryRowContext(ctx, `SELECT updated_at FROM writings_config WHERE id = 'writings_1'`).Scan(&config.UpdatedAt)
	if err != nil {
		return model.WritingConfig{}, err
	}
	pinned, err := s.GetPinnedIds(ctx, model.ContentKindArticle)
	if err != nil {
		return model.WritingConfig{}, err
	}
	config.PinnedIds = pinned
	return config, nil
}

func (s *Store) GetPinnedIds(ctx context.Context, kind model.ContentKind) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT content_id FROM pins WHERE kind = ? ORDER BY position ASC, created_at ASC`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SetPinnedIds replaces the whole pin set for a kind. Order in pins is the
// position index: callers pass the intended display order. The config
// singleton's updated_at advances so admin reads reflect the last mutation.
func (s *Store) SetPinnedIds(ctx context.Context, kind model.ContentKind, ids []string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM pins WHERE kind = ?`, kind); err != nil {
		return err
	}
	now := nowRFC3339()
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO pins (content_id, kind, position, created_at) VALUES (?, ?, ?, ?)`, id, kind, index, now); err != nil {
			return err
		}
	}
	configTable := "thoughts_config"
	configID := "thoughts_1"
	if kind == model.ContentKindArticle {
		configTable = "writings_config"
		configID = "writings_1"
	}
	if _, err := tx.ExecContext(ctx, `UPDATE `+configTable+` SET updated_at = ? WHERE id = ?`, now, configID); err != nil {
		return err
	}
	return tx.Commit()
}
