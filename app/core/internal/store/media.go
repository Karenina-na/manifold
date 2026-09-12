package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

var ErrMediaNotFound = errors.New("media not found")

// InsertMedia persists an upload, deduplicating by SHA256: re-uploading the
// same bytes returns the existing row (created=false) so editor re-inserts
// never grow the database. Deduplication is a single INSERT ... ON CONFLICT
// rather than a SELECT followed by an INSERT: two concurrent uploads of the
// same bytes would both miss the lookup and the loser would then fail the
// UNIQUE(sha256) index with a 500, which is precisely the case deduplication
// exists to absorb. The loser now reads back the winner's row instead.
func (s *Store) InsertMedia(ctx context.Context, mime, filename, sha256Hex string, data []byte) (model.Media, bool, error) {
	id, err := newMediaID()
	if err != nil {
		return model.Media{}, false, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.DB.ExecContext(ctx, `INSERT INTO media (id, mime, size, sha256, filename, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING`,
		id, mime, len(data), sha256Hex, filename, data, now)
	if err != nil {
		return model.Media{}, false, err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return model.Media{}, false, err
	}
	if inserted == 0 {
		existing, err := s.findMediaBySHA(ctx, sha256Hex)
		if err != nil {
			return model.Media{}, false, err
		}
		return existing, false, nil
	}
	media := model.Media{ID: id, Mime: mime, Size: int64(len(data)), Filename: filename, SHA256: sha256Hex, CreatedAt: now}
	return media, true, nil
}

// newMediaID returns a random media identifier. A timestamp-derived id is only
// as unique as the clock: two uploads inside the same clock tick — or on a
// platform whose clock resolution is coarser than the format — collided on the
// media primary key.
func newMediaID() (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	return "media_" + hex.EncodeToString(random[:]), nil
}

func (s *Store) findMediaBySHA(ctx context.Context, sha256Hex string) (model.Media, error) {
	var media model.Media
	err := s.DB.QueryRowContext(ctx, `SELECT id, mime, size, sha256, filename, created_at FROM media WHERE sha256 = ?`, sha256Hex).Scan(&media.ID, &media.Mime, &media.Size, &media.SHA256, &media.Filename, &media.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Media{}, ErrMediaNotFound
	}
	if err != nil {
		return model.Media{}, err
	}
	return media, nil
}

func (s *Store) GetMedia(ctx context.Context, id string) (model.Media, []byte, error) {
	var media model.Media
	var data []byte
	err := s.DB.QueryRowContext(ctx, `SELECT id, mime, size, sha256, filename, created_at, data FROM media WHERE id = ?`, id).Scan(&media.ID, &media.Mime, &media.Size, &media.SHA256, &media.Filename, &media.CreatedAt, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Media{}, nil, ErrMediaNotFound
	}
	if err != nil {
		return model.Media{}, nil, err
	}
	return media, data, nil
}

func (s *Store) ListMedia(ctx context.Context, page, pageSize int, needle string) ([]model.Media, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 50 {
		pageSize = 50
	}
	filter := `WHERE (? = '' OR filename LIKE ? ESCAPE '\' OR id LIKE ? ESCAPE '\')`
	args := []any{needle, likePattern(needle), likePattern(needle)}
	var total int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM media `+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	offset := (page - 1) * pageSize
	if offset >= total && total > 0 {
		page = (total + pageSize - 1) / pageSize
		offset = (page - 1) * pageSize
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, mime, size, sha256, filename, created_at FROM media `+filter+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
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

// MediaReferences lists non-deleted content whose body embeds this media URL.
// The query excludes DELETED rows, so status is always DRAFT or PUBLISHED.
func (s *Store) MediaReferences(ctx context.Context, id string) ([]model.MediaReference, error) {
	needle := "/api/v1/media/" + id
	// Media ids are `media_<hex>`, so the underscore is a real LIKE wildcard
	// here: without the escape, `media_ab` would also match `mediaXab`.
	rows, err := s.DB.QueryContext(ctx, `SELECT id, kind, slug, title, status FROM content WHERE status != 'DELETED' AND body LIKE ? ESCAPE '\'`, likePattern(needle))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := []model.MediaReference{}
	for rows.Next() {
		var ref model.MediaReference
		var title sql.NullString
		if err := rows.Scan(&ref.ContentID, &ref.Kind, &ref.Slug, &title, &ref.Status); err != nil {
			return nil, err
		}
		if title.Valid {
			ref.Title = &title.String
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

func (s *Store) DeleteMedia(ctx context.Context, id string) error {
	result, err := s.DB.ExecContext(ctx, `DELETE FROM media WHERE id = ?`, id)
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
