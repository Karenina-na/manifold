package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

var ErrMediaNotFound = errors.New("media not found")

// InsertMedia persists an upload, deduplicating by SHA256: re-uploading the
// same bytes returns the existing row (created=false) so editor re-inserts
// never grow the database.
func (s *Store) InsertMedia(mime, filename, sha256Hex string, data []byte) (model.Media, bool, error) {
	existing, err := s.findMediaBySHA(sha256Hex)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, ErrMediaNotFound) {
		return model.Media{}, false, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	id := "media_" + time.Now().UTC().Format("20060102150405.000000000")
	_, err = s.DB.Exec(`INSERT INTO media (id, mime, size, sha256, filename, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, id, mime, len(data), sha256Hex, filename, data, now)
	if err != nil {
		return model.Media{}, false, err
	}
	media := model.Media{ID: id, Mime: mime, Size: int64(len(data)), Filename: filename, SHA256: sha256Hex, CreatedAt: now}
	return media, true, nil
}

func (s *Store) findMediaBySHA(sha256Hex string) (model.Media, error) {
	var media model.Media
	err := s.DB.QueryRow(`SELECT id, mime, size, sha256, filename, created_at FROM media WHERE sha256 = ?`, sha256Hex).Scan(&media.ID, &media.Mime, &media.Size, &media.SHA256, &media.Filename, &media.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Media{}, ErrMediaNotFound
	}
	if err != nil {
		return model.Media{}, err
	}
	return media, nil
}

func (s *Store) GetMedia(id string) (model.Media, []byte, error) {
	var media model.Media
	var data []byte
	err := s.DB.QueryRow(`SELECT id, mime, size, sha256, filename, created_at, data FROM media WHERE id = ?`, id).Scan(&media.ID, &media.Mime, &media.Size, &media.SHA256, &media.Filename, &media.CreatedAt, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Media{}, nil, ErrMediaNotFound
	}
	if err != nil {
		return model.Media{}, nil, err
	}
	return media, data, nil
}

func (s *Store) ListMedia(page, pageSize int, needle string) ([]model.Media, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 50 {
		pageSize = 50
	}
	filter := `WHERE (? = '' OR filename LIKE '%' || ? || '%' OR id LIKE '%' || ? || '%')`
	args := []any{needle, needle, needle}
	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM media `+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	offset := (page - 1) * pageSize
	if offset >= total && total > 0 {
		page = (total + pageSize - 1) / pageSize
		offset = (page - 1) * pageSize
	}
	rows, err := s.DB.Query(`SELECT id, mime, size, sha256, filename, created_at FROM media `+filter+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []model.Media{}
	for rows.Next() {
		var media model.Media
		if err := rows.Scan(&media.ID, &media.Mime, &media.Size, &media.SHA256, &media.Filename, &media.CreatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, media)
	}
	return items, total, rows.Err()
}

func (s *Store) DeleteMedia(id string) error {
	result, err := s.DB.Exec(`DELETE FROM media WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return ErrMediaNotFound
	}
	return nil
}

func SanitizeMediaFilename(value string) string {
	if index := strings.LastIndexAny(value, "/\\"); index >= 0 {
		value = value[index+1:]
	}
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, value)
	runes := []rune(value)
	if len(runes) > 200 {
		value = string(runes[:200])
	}
	return strings.TrimSpace(value)
}
