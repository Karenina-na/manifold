package store

import (
	"database/sql"
	"errors"
	"time"
)

var ErrCredentialNotFound = errors.New("admin credential not found")
var ErrSessionNotFound = errors.New("admin session not found")

// ensureAdminCredential seeds the bootstrap credential into an empty table.
// It is a no-op when the table already has a row or either value is empty, so
// upgraded databases (which skip content seeding) still get a way to log in.
func (s *Store) ensureAdminCredential(username, passwordHash string) error {
	if username == "" || passwordHash == "" {
		return nil
	}
	var count int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM admin_credentials`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := s.DB.Exec(`INSERT INTO admin_credentials (id, username, password_hash, updated_at) VALUES (?, ?, ?, ?)`, "admin_1", username, passwordHash, nowRFC3339())
	return err
}

// GetAdminCredential returns the bcrypt hash for a username.
func (s *Store) GetAdminCredential(username string) (string, error) {
	var hash string
	err := s.DB.QueryRow(`SELECT password_hash FROM admin_credentials WHERE username = ? LIMIT 1`, username).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrCredentialNotFound
	}
	if err != nil {
		return "", err
	}
	return hash, nil
}

// UpdateAdminCredential replaces the hash for a username.
func (s *Store) UpdateAdminCredential(username, passwordHash string) error {
	_, err := s.DB.Exec(`UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE username = ?`, passwordHash, nowRFC3339(), username)
	return err
}

// CreateSession records a fresh session keyed by its JWT jti.
func (s *Store) CreateSession(id, subject string, now, expiresAt time.Time) error {
	_, err := s.DB.Exec(`INSERT INTO admin_sessions (id, subject, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)`, id, subject, now.UTC().Format(time.RFC3339), expiresAt.UTC().Format(time.RFC3339))
	return err
}

// SessionLive reports whether a session is still active: it must exist, not be
// revoked, and not have expired.
func (s *Store) SessionLive(id string, now time.Time) (bool, error) {
	var exists bool
	var expiresAt string
	var revokedAt sql.NullString
	err := s.DB.QueryRow(`SELECT 1, expires_at, revoked_at FROM admin_sessions WHERE id = ?`, id).Scan(&exists, &expiresAt, &revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if revokedAt.Valid {
		return false, nil
	}
	exp, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return false, err
	}
	return now.Before(exp), nil
}

// RevokeSession redacts one session. Idempotent: revoking an already-revoked
// or missing id is not an error.
func (s *Store) RevokeSession(id string, now time.Time) error {
	_, err := s.DB.Exec(`UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now.UTC().Format(time.RFC3339), id)
	return err
}

// GetSession loads one session row regardless of state; ownership checks and
// revocation happen in the handler layer.
func (s *Store) GetSession(id string) (AdminSessionRow, error) {
	var row AdminSessionRow
	var createdAt, expiresAt string
	var revokedAt sql.NullString
	err := s.DB.QueryRow(`SELECT id, subject, created_at, expires_at, revoked_at FROM admin_sessions WHERE id = ?`, id).Scan(&row.ID, &row.Subject, &createdAt, &expiresAt, &revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AdminSessionRow{}, ErrSessionNotFound
	}
	if err != nil {
		return AdminSessionRow{}, err
	}
	if row.CreatedAt, err = time.Parse(time.RFC3339, createdAt); err != nil {
		return AdminSessionRow{}, err
	}
	if row.ExpiresAt, err = time.Parse(time.RFC3339, expiresAt); err != nil {
		return AdminSessionRow{}, err
	}
	if revokedAt.Valid {
		parsed, err := time.Parse(time.RFC3339, revokedAt.String)
		if err != nil {
			return AdminSessionRow{}, err
		}
		row.RevokedAt = &parsed
	}
	return row, nil
}

// RevokeSessions redacts every active session for a subject except one id.
func (s *Store) RevokeSessions(subject string, exceptCurrentID string, now time.Time) error {
	_, err := s.DB.Exec(`UPDATE admin_sessions SET revoked_at = ? WHERE subject = ? AND id != ? AND revoked_at IS NULL`, now.UTC().Format(time.RFC3339), subject, exceptCurrentID)
	return err
}

// AdminSessionRow is one stored session row.
type AdminSessionRow struct {
	ID        string
	Subject   string
	CreatedAt time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// AdminSessions lists the live (not revoked, not expired) session rows for a
// subject, newest first. Revoked sessions are soft-deleted history: they stay
// in the table for audit but leave the admin list.
func (s *Store) AdminSessions(subject string) ([]AdminSessionRow, error) {
	rows, err := s.DB.Query(`SELECT id, created_at, expires_at, revoked_at FROM admin_sessions WHERE subject = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, subject, nowRFC3339())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []AdminSessionRow{}
	for rows.Next() {
		var session AdminSessionRow
		var createdAt, expiresAt string
		var revokedAt sql.NullString
		if err := rows.Scan(&session.ID, &createdAt, &expiresAt, &revokedAt); err != nil {
			return nil, err
		}
		if session.CreatedAt, err = time.Parse(time.RFC3339, createdAt); err != nil {
			return nil, err
		}
		if session.ExpiresAt, err = time.Parse(time.RFC3339, expiresAt); err != nil {
			return nil, err
		}
		if revokedAt.Valid {
			if parsed, err := time.Parse(time.RFC3339, revokedAt.String); err != nil {
				return nil, err
			} else {
				session.RevokedAt = &parsed
			}
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}
