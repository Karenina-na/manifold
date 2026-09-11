package store

import (
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetLikeSummary(contentID, visitorID string) (model.LikeSummary, error) {
	var summary model.LikeSummary
	var viewerLiked int
	err := s.DB.QueryRow(`
		SELECT (SELECT like_count FROM content WHERE id = ?),
		EXISTS(SELECT 1 FROM likes WHERE content_id = ? AND visitor_id = ?)`, contentID, contentID, visitorID).Scan(&summary.LikeCount, &viewerLiked)
	if err != nil {
		return summary, err
	}
	summary.ViewerLiked = viewerLiked == 1
	return summary, nil
}

// SetLike/DeleteLike keep the content row's like_count in sync in the same
// transaction as the like row change.
func (s *Store) SetLike(contentID, visitorID string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT OR IGNORE INTO likes (id, content_id, visitor_id, created_at) VALUES (?, ?, ?, ?)`, "like_"+contentID+"_"+visitorID, contentID, visitorID, nowRFC3339())
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected > 0 {
		if _, err := tx.Exec(`UPDATE content SET like_count = like_count + 1 WHERE id = ?`, contentID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteLike(contentID, visitorID string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`DELETE FROM likes WHERE content_id = ? AND visitor_id = ?`, contentID, visitorID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected > 0 {
		if _, err := tx.Exec(`UPDATE content SET like_count = like_count - 1 WHERE id = ?`, contentID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RecordContentView increments the cumulative public view counter and appends
// a per-day analytics event. Identified visitors dedupe to one event per
// content per UTC day via the partial unique index.
func (s *Store) RecordContentView(contentID, visitorID, referrer string) (int, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`UPDATE content SET view_count = view_count + 1 WHERE id = ?`, contentID); err != nil {
		return 0, err
	}
	var viewCount int
	if err := tx.QueryRow(`SELECT view_count FROM content WHERE id = ?`, contentID).Scan(&viewCount); err != nil {
		return 0, err
	}
	now := timeNowUTC()
	day := now.Format("2006-01-02")
	if visitorID == "" {
		if _, err := tx.Exec(`INSERT INTO content_view_events (content_id, visitor_id, referrer, day, created_at) VALUES (?, '', ?, ?, ?)`, contentID, referrer, day, now.Format(time.RFC3339)); err != nil {
			return 0, err
		}
	} else {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO content_view_events (content_id, visitor_id, referrer, day, created_at) VALUES (?, ?, ?, ?, ?)`, contentID, visitorID, referrer, day, now.Format(time.RFC3339)); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return viewCount, nil
}
