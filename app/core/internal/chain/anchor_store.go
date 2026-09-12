package chain

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// EnsureSiteKey returns the site_key_1 singleton, generating and persisting a
// fresh ed25519 pair when the row is missing. It is idempotent and safe to
// call from every Submit.
func (l *Ledger) EnsureSiteKey(ctx context.Context) (SiteKey, error) {
	if key, err := l.siteKeyByID(ctx, "site_key_1"); err == nil {
		return key, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return SiteKey{}, err
	}
	publicHex, privateHex, err := NewSiteKey()
	if err != nil {
		return SiteKey{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := l.db.ExecContext(ctx, `INSERT INTO chain_keys (key_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?)`, "site_key_1", publicHex, privateHex, now); err != nil {
		// A racing insert is fine: read back the winner.
		if key, readErr := l.siteKeyByID(ctx, "site_key_1"); readErr == nil {
			return key, nil
		}
		return SiteKey{}, err
	}
	return SiteKey{KeyID: "site_key_1", PublicKey: publicHex, PrivateKey: privateHex, CreatedAt: now}, nil
}

func (l *Ledger) siteKeyByID(ctx context.Context, keyID string) (SiteKey, error) {
	var key SiteKey
	err := l.db.QueryRowContext(ctx, `SELECT key_id, public_key, private_key, created_at FROM chain_keys WHERE key_id = ?`, keyID).
		Scan(&key.KeyID, &key.PublicKey, &key.PrivateKey, &key.CreatedAt)
	return key, err
}

// ListSiteKeys returns all public keys for GET /api/v1/chain/keys.
func (l *Ledger) ListSiteKeys(ctx context.Context) ([]SiteKey, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT key_id, public_key, private_key, created_at FROM chain_keys ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]SiteKey, 0)
	for rows.Next() {
		var key SiteKey
		if err := rows.Scan(&key.KeyID, &key.PublicKey, &key.PrivateKey, &key.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// Submit hashes payload, signs it with the site key and persists a pending
// anchor. The payload bytes are discarded after hashing; the caller decides
// whether they are raw bytes or a canonical JSON string (docs/chain.md §3.4).
// subjectRef is the caller-owned stable resource reference per source
// semantics (docs/chain.md §4.1) — the chain derives no business meaning from
// metadata. Wake is non-blocking: the signal is a hint, ticks find the work
// anyway.
func (l *Ledger) Submit(ctx context.Context, source string, payload []byte, label, subjectRef string, metadata map[string]any) (Anchor, error) {
	if !validSources[source] {
		return Anchor{}, fmt.Errorf("unknown anchor source %q", source)
	}
	key, err := l.EnsureSiteKey(ctx)
	if err != nil {
		return Anchor{}, err
	}
	subjectHash := SubjectHashHex(payload)
	signature, err := SignSubjectHash(key.PrivateKey, subjectHash)
	if err != nil {
		return Anchor{}, err
	}
	id := newCertID()
	createdAt := time.Now().UTC().Format(time.RFC3339)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return Anchor{}, err
	}
	if _, err := l.db.ExecContext(ctx, `INSERT INTO chain_anchors (id, subject_hash, source, subject_ref, label, metadata_json, site_key_id, site_public_key, site_signature, created_at, block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		id, subjectHash, source, subjectRef, label, string(metadataJSON), key.KeyID, key.PublicKey, signature, createdAt); err != nil {
		return Anchor{}, err
	}
	l.Wake()
	return Anchor{ID: id, SubjectHash: subjectHash, Source: source, SubjectRef: subjectRef, Label: label,
		Metadata: metadata, SiteKeyID: key.KeyID, SitePublicKey: key.PublicKey, SiteSignature: signature,
		CreatedAt: createdAt}, nil
}

func newCertID() string {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		// crypto/rand failure leaves no safe fallback; the panic is caught by
		// callers that treat Submit errors as non-critical.
		panic(fmt.Errorf("cert id entropy: %w", err))
	}
	return "cert_" + hex.EncodeToString(raw)
}

func (l *Ledger) scanAnchor(row interface{ Scan(dest ...any) error }) (Anchor, error) {
	var anchor Anchor
	var metadataJSON string
	var blockID any
	if err := row.Scan(&anchor.ID, &anchor.SubjectHash, &anchor.Source, &anchor.SubjectRef, &anchor.Label,
		&metadataJSON, &anchor.SiteKeyID, &anchor.SitePublicKey, &anchor.SiteSignature, &anchor.CreatedAt, &blockID); err != nil {
		return Anchor{}, err
	}
	anchor.Metadata = map[string]any{}
	_ = json.Unmarshal([]byte(metadataJSON), &anchor.Metadata)
	if blockID != nil {
		if id, ok := blockID.(string); ok {
			anchor.BlockID = id
		}
	}
	return anchor, nil
}

const anchorColumns = `id, subject_hash, source, subject_ref, label, metadata_json, site_key_id, site_public_key, site_signature, created_at, block_id`

func (l *Ledger) GetAnchor(ctx context.Context, id string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRowContext(ctx, `SELECT `+anchorColumns+` FROM chain_anchors WHERE id = ?`, id))
}

// LatestAnchorByHash returns the most recent certificate for a subject hash:
// repeated submissions of the same payload produce distinct certificates and
// verification reports the newest (docs/chain.md §10).
func (l *Ledger) LatestAnchorByHash(ctx context.Context, subjectHash string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRowContext(ctx, `SELECT `+anchorColumns+` FROM chain_anchors WHERE subject_hash = ? ORDER BY created_at DESC, id DESC LIMIT 1`, subjectHash))
}

// LatestContentAnchor powers ContentDetail.latestAnchor.
func (l *Ledger) LatestContentAnchor(ctx context.Context, contentID string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRowContext(ctx, `SELECT `+anchorColumns+` FROM chain_anchors WHERE source = ? AND subject_ref = ? ORDER BY created_at DESC, id DESC LIMIT 1`, SourceContent, contentID))
}

func (l *Ledger) PendingAnchors(ctx context.Context) ([]Anchor, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT `+anchorColumns+` FROM chain_anchors WHERE block_id IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`, l.cfg.MaxBlockAnchors)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return l.collectAnchors(rows)
}

func (l *Ledger) collectAnchors(rows *sql.Rows) ([]Anchor, error) {
	anchors := make([]Anchor, 0)
	for rows.Next() {
		anchor, err := l.scanAnchor(rows)
		if err != nil {
			return nil, err
		}
		anchors = append(anchors, anchor)
	}
	return anchors, rows.Err()
}

// PendingCount is the buffered-anchor count for the miner and ChainInfo.
func (l *Ledger) PendingCount(ctx context.Context) (int, error) {
	var count int
	err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chain_anchors WHERE block_id IS NULL`).Scan(&count)
	return count, err
}

// OldestPendingAge reports how long the oldest buffered anchor has waited;
// 0 when nothing is pending.
func (l *Ledger) OldestPendingAge(ctx context.Context) (time.Duration, error) {
	var oldest string
	err := l.db.QueryRowContext(ctx, `SELECT MIN(created_at) FROM chain_anchors WHERE block_id IS NULL`).Scan(&oldest)
	if err != nil || oldest == "" {
		return 0, err
	}
	created, err := time.Parse(time.RFC3339, oldest)
	if err != nil {
		return 0, err
	}
	return time.Since(created), nil
}

// ListAnchors pages anchors newest-first with optional source/ref filters.
func (l *Ledger) ListAnchors(ctx context.Context, options AnchorListOptions) ([]Anchor, int, error) {
	where := "1=1"
	args := []any{}
	if options.Source != "" {
		where += " AND source = ?"
		args = append(args, options.Source)
	}
	if options.Ref != "" {
		where += " AND subject_ref = ?"
		args = append(args, options.Ref)
	}
	var total int
	if err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chain_anchors WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageSize := options.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := options.Page
	if page < 1 {
		page = 1
	}
	rows, err := l.db.QueryContext(ctx, `SELECT `+anchorColumns+` FROM chain_anchors WHERE `+where+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	anchors, err := l.collectAnchors(rows)
	if err != nil {
		return nil, 0, err
	}
	return anchors, total, nil
}

func (l *Ledger) AnchorCount(ctx context.Context) (int, error) {
	var count int
	err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chain_anchors`).Scan(&count)
	return count, err
}
