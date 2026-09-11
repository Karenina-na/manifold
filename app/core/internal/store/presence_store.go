package store

import (
	"time"
)

func (s *Store) TouchPresence(visitorID string) (int, error) {
	now := time.Now().UTC()
	cutoff := now.Add(-presenceTTL).Format(time.RFC3339)
	if _, err := s.DB.Exec(`DELETE FROM presence WHERE last_seen_at < ?`, cutoff); err != nil {
		return 0, err
	}
	if _, err := s.DB.Exec(`INSERT INTO presence (visitor_id, last_seen_at) VALUES (?, ?) ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`, visitorID, now.Format(time.RFC3339)); err != nil {
		return 0, err
	}
	var activeVisitors int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM presence WHERE last_seen_at >= ?`, cutoff).Scan(&activeVisitors); err != nil {
		return 0, err
	}
	return activeVisitors, nil
}
