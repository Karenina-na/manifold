package chain

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sources are the anchor provenance enum (docs/chain.md §3.1). Values are
// validated here rather than by SQL CHECK so new sources need no table change.
const (
	SourceContent  = "content"
	SourceComment  = "comment"
	SourceReaction = "reaction"
	SourceProfile  = "profile"
	SourceSite     = "site"
	SourceMedia    = "media"
	SourceAuth     = "auth"
	SourceVisitor  = "visitor"
	SourceAdmin    = "admin"
)

var validSources = map[string]bool{
	SourceContent: true, SourceComment: true, SourceReaction: true, SourceProfile: true,
	SourceSite: true, SourceMedia: true, SourceAuth: true, SourceVisitor: true, SourceAdmin: true,
}

// ValidSource reports whether source is one of the nine anchor origins.
func ValidSource(source string) bool { return validSources[source] }

// LedgerConfig mirrors the CORE_CHAIN_* environment (docs/chain.md §5).
type LedgerConfig struct {
	ProofMode       ProofMode
	Difficulty      int
	SimDelay        time.Duration
	BatchSize       int
	MaxBlockAnchors int
	FlushTimeout    time.Duration
	AnchorMaxBytes  int64
}

// SiteKey is one row of chain_keys; only the site_key_1 singleton is created
// today, the table shape leaves room for future rotation.
type SiteKey struct {
	KeyID      string
	PublicKey  string
	PrivateKey string
	CreatedAt  string
}

// Anchor is one certificate row (chain_anchors). BlockID is the empty string
// while the anchor is pending; HTTP projections map that to status/blockId.
type Anchor struct {
	ID            string
	SubjectHash   string
	Source        string
	SubjectRef    string
	Label         string
	Metadata      map[string]any
	SiteKeyID     string
	SitePublicKey string
	SiteSignature string
	CreatedAt     string
	BlockID       string
}

// Block is one chain_blocks row with its ordered cert ids.
type Block struct {
	ID         string
	Index      int
	PrevHash   string
	Timestamp  string
	CertRoot   string
	CertIDs    []string
	Nonce      int
	ProofMode  ProofMode
	Difficulty int
	Hash       string
}

// AnchorListOptions filters the public anchor listing.
type AnchorListOptions struct {
	Source   string
	Ref      string
	Page     int
	PageSize int
}

// ChainInfoResult is the chain overview served by GET /api/v1/chain.
type ChainInfoResult struct {
	Height         int
	TotalAnchors   int
	PendingAnchors int
	ProofMode      ProofMode
	Difficulty     int
	GenesisHash    string
	TipHash        string
	SitePublicKey  string
}

var ErrEmptyChain = errors.New("chain has no blocks yet")

// Ledger owns the three chain tables on the shared SQLite handle. It never
// imports internal/store: business semantics stay at the caller (docs/chain.md §2).
type Ledger struct {
	db     *sql.DB
	cfg    LedgerConfig
	wake   chan struct{}
	sleepF func(time.Duration)
}

func NewLedger(db *sql.DB, cfg LedgerConfig) *Ledger {
	if !cfg.ProofMode.Valid() {
		cfg.ProofMode = ProofModeSim
	}
	if cfg.MaxBlockAnchors < 1 {
		cfg.MaxBlockAnchors = 500
	}
	if cfg.BatchSize < 1 {
		cfg.BatchSize = 32
	}
	return &Ledger{db: db, cfg: cfg, wake: make(chan struct{}, 1), sleepF: time.Sleep}
}

// EnsureSiteKey returns the site_key_1 singleton, generating and persisting a
// fresh ed25519 pair when the row is missing. It is idempotent and safe to
// call from every Submit.
func (l *Ledger) EnsureSiteKey() (SiteKey, error) {
	if key, err := l.siteKeyByID("site_key_1"); err == nil {
		return key, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return SiteKey{}, err
	}
	publicHex, privateHex, err := NewSiteKey()
	if err != nil {
		return SiteKey{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := l.db.Exec(`INSERT INTO chain_keys (key_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?)`, "site_key_1", publicHex, privateHex, now); err != nil {
		// A racing insert is fine: read back the winner.
		if key, readErr := l.siteKeyByID("site_key_1"); readErr == nil {
			return key, nil
		}
		return SiteKey{}, err
	}
	return SiteKey{KeyID: "site_key_1", PublicKey: publicHex, PrivateKey: privateHex, CreatedAt: now}, nil
}

func (l *Ledger) siteKeyByID(keyID string) (SiteKey, error) {
	var key SiteKey
	err := l.db.QueryRow(`SELECT key_id, public_key, private_key, created_at FROM chain_keys WHERE key_id = ?`, keyID).
		Scan(&key.KeyID, &key.PublicKey, &key.PrivateKey, &key.CreatedAt)
	return key, err
}

// ListSiteKeys returns all public keys for GET /api/v1/chain/keys.
func (l *Ledger) ListSiteKeys() ([]SiteKey, error) {
	rows, err := l.db.Query(`SELECT key_id, public_key, private_key, created_at FROM chain_keys ORDER BY created_at ASC`)
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
func (l *Ledger) Submit(source string, payload []byte, label, subjectRef string, metadata map[string]any) (Anchor, error) {
	if !validSources[source] {
		return Anchor{}, fmt.Errorf("unknown anchor source %q", source)
	}
	key, err := l.EnsureSiteKey()
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
	if _, err := l.db.Exec(`INSERT INTO chain_anchors (id, subject_hash, source, subject_ref, label, metadata_json, site_key_id, site_public_key, site_signature, created_at, block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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

func (l *Ledger) GetAnchor(id string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRow(`SELECT `+anchorColumns+` FROM chain_anchors WHERE id = ?`, id))
}

// LatestAnchorByHash returns the most recent certificate for a subject hash:
// repeated submissions of the same payload produce distinct certificates and
// verification reports the newest (docs/chain.md §10).
func (l *Ledger) LatestAnchorByHash(subjectHash string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRow(`SELECT `+anchorColumns+` FROM chain_anchors WHERE subject_hash = ? ORDER BY created_at DESC, id DESC LIMIT 1`, subjectHash))
}

// LatestContentAnchor powers ContentDetail.latestAnchor.
func (l *Ledger) LatestContentAnchor(contentID string) (Anchor, error) {
	return l.scanAnchor(l.db.QueryRow(`SELECT `+anchorColumns+` FROM chain_anchors WHERE source = ? AND subject_ref = ? ORDER BY created_at DESC, id DESC LIMIT 1`, SourceContent, contentID))
}

func (l *Ledger) PendingAnchors() ([]Anchor, error) {
	rows, err := l.db.Query(`SELECT `+anchorColumns+` FROM chain_anchors WHERE block_id IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`, l.cfg.MaxBlockAnchors)
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
func (l *Ledger) PendingCount() (int, error) {
	var count int
	err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE block_id IS NULL`).Scan(&count)
	return count, err
}

// OldestPendingAge reports how long the oldest buffered anchor has waited;
// 0 when nothing is pending.
func (l *Ledger) OldestPendingAge() (time.Duration, error) {
	var oldest string
	err := l.db.QueryRow(`SELECT MIN(created_at) FROM chain_anchors WHERE block_id IS NULL`).Scan(&oldest)
	if err != nil || oldest == "" {
		return 0, err
	}
	created, err := time.Parse(time.RFC3339, oldest)
	if err != nil {
		return 0, err
	}
	return time.Since(created), nil
}

// Tip returns the highest block; ErrEmptyChain on a fresh database.
func (l *Ledger) Tip() (Block, error) {
	block, err := l.scanBlock(l.db.QueryRow(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index DESC LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return Block{}, ErrEmptyChain
	}
	return block, err
}

const blockColumns = `id, block_index, prev_hash, timestamp, cert_root, cert_ids_json, nonce, proof_mode, difficulty, hash`

func (l *Ledger) scanBlock(row interface{ Scan(dest ...any) error }) (Block, error) {
	var block Block
	var certIDsJSON string
	var mode string
	if err := row.Scan(&block.ID, &block.Index, &block.PrevHash, &block.Timestamp, &block.CertRoot, &certIDsJSON, &block.Nonce, &mode, &block.Difficulty, &block.Hash); err != nil {
		return Block{}, err
	}
	block.ProofMode = ProofMode(mode)
	if err := json.Unmarshal([]byte(certIDsJSON), &block.CertIDs); err != nil {
		return Block{}, err
	}
	if block.CertIDs == nil {
		block.CertIDs = []string{}
	}
	return block, nil
}

// ErrTipMoved reports that the chain tip changed between the mining decision
// and the insert; the caller re-evaluates with the new tip.
var ErrTipMoved = errors.New("chain tip moved during mining")

// mineHeader assembles the block header and runs PoW against a tip snapshot
// taken before mining starts. It holds no transaction: with the single SQLite
// connection, mining inside the tx would hold the database busy for the sim
// delay or the whole proof search, stalling every request (docs/chain.md §9).
func (l *Ledger) mineHeader(certIDs []string) (BlockHeader, error) {
	difficulty := l.cfg.Difficulty
	if l.cfg.ProofMode == ProofModeSim {
		difficulty = 0
	}
	tip, err := l.Tip()
	if err != nil && !errors.Is(err, ErrEmptyChain) {
		return BlockHeader{}, err
	}
	emptyChain := errors.Is(err, ErrEmptyChain)
	if emptyChain && len(certIDs) > 0 {
		return BlockHeader{}, errors.New("genesis must carry no certificates; mine it first, then pack")
	}
	header := BlockHeader{Index: 0, PrevHash: strings.Repeat("0", 64), Timestamp: time.Now().UTC().Format(time.RFC3339),
		CertRoot: MerkleRoot(certIDs), ProofMode: l.cfg.ProofMode, Difficulty: difficulty}
	if !emptyChain {
		header.Index = tip.Index + 1
		header.PrevHash = tip.Hash
	}

	// PoW: sim sleeps its configured delay and keeps nonce 0; proof searches
	// for a real leading-zero collision.
	switch l.cfg.ProofMode {
	case ProofModeSim:
		l.sleepF(l.cfg.SimDelay)
	default:
		for header.Nonce = 0; ; header.Nonce++ {
			if header.Satisfies() {
				break
			}
		}
	}
	header.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return header, nil
}

// InsertBlock assembles and mines one block over certIDs: the header and PoW
// run outside any transaction (holding the single connection for the sim
// delay or a proof search would stall every request), then a short
// transaction re-checks that the tip is still the one mined against, inserts
// the block and backfills pending→anchored (the only legal UPDATE on the
// chain tables). Genesis is mined by calling with nil certs on an empty chain.
func (l *Ledger) InsertBlock(certIDs []string) (Block, error) {
	if certIDs == nil {
		certIDs = []string{}
	}
	if len(certIDs) > l.cfg.MaxBlockAnchors {
		certIDs = certIDs[:l.cfg.MaxBlockAnchors]
	}
	header, err := l.mineHeader(certIDs)
	if err != nil {
		return Block{}, err
	}

	tx, err := l.db.Begin()
	if err != nil {
		return Block{}, err
	}
	defer func() { _ = tx.Rollback() }()

	tip, err := l.tipTx(tx)
	if err != nil {
		return Block{}, err
	}
	if tip == nil && header.Index != 0 || tip != nil && (tip.Index != header.Index-1 || tip.Hash != header.PrevHash) {
		return Block{}, ErrTipMoved
	}
	certIDsJSON, err := json.Marshal(certIDs)
	if err != nil {
		return Block{}, err
	}
	if _, err := tx.Exec(`INSERT INTO chain_blocks (id, block_index, prev_hash, timestamp, cert_root, cert_ids_json, nonce, proof_mode, difficulty, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		fmt.Sprintf("block_%d", header.Index), header.Index, header.PrevHash, header.Timestamp, header.CertRoot, string(certIDsJSON),
		header.Nonce, string(header.ProofMode), header.Difficulty, header.Hash()); err != nil {
		return Block{}, err
	}
	if len(certIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(certIDs)), ",")
		args := make([]any, 0, len(certIDs)+1)
		args = append(args, fmt.Sprintf("block_%d", header.Index))
		for _, id := range certIDs {
			args = append(args, id)
		}
		if _, err := tx.Exec(`UPDATE chain_anchors SET block_id = ? WHERE id IN (`+placeholders+`) AND block_id IS NULL`, args...); err != nil {
			return Block{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Block{}, err
	}
	return Block{ID: fmt.Sprintf("block_%d", header.Index), Index: header.Index, PrevHash: header.PrevHash, Timestamp: header.Timestamp,
		CertRoot: header.CertRoot, CertIDs: certIDs, Nonce: header.Nonce, ProofMode: header.ProofMode,
		Difficulty: header.Difficulty, Hash: header.Hash()}, nil
}

func (l *Ledger) tipTx(tx *sql.Tx) (*Block, error) {
	block, err := l.scanBlock(tx.QueryRow(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index DESC LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &block, nil
}

// ListAnchors pages anchors newest-first with optional source/ref filters.
func (l *Ledger) ListAnchors(options AnchorListOptions) ([]Anchor, int, error) {
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
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE `+where, args...).Scan(&total); err != nil {
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
	rows, err := l.db.Query(`SELECT `+anchorColumns+` FROM chain_anchors WHERE `+where+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
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

// ListBlocks pages block summaries newest-first.
func (l *Ledger) ListBlocks(page, pageSize int) ([]Block, int, error) {
	var total int
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_blocks`).Scan(&total); err != nil {
		return nil, 0, err
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if page < 1 {
		page = 1
	}
	rows, err := l.db.Query(`SELECT `+blockColumns+` FROM chain_blocks ORDER BY block_index DESC LIMIT ? OFFSET ?`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	blocks := make([]Block, 0)
	for rows.Next() {
		block, err := l.scanBlock(rows)
		if err != nil {
			return nil, 0, err
		}
		blocks = append(blocks, block)
	}
	return blocks, total, rows.Err()
}

// GetBlock returns one block with its contained anchors.
func (l *Ledger) GetBlock(id string) (Block, []Anchor, error) {
	block, err := l.scanBlock(l.db.QueryRow(`SELECT `+blockColumns+` FROM chain_blocks WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Block{}, nil, sql.ErrNoRows
	}
	if err != nil {
		return Block{}, nil, err
	}
	anchors := make([]Anchor, 0)
	if len(block.CertIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(block.CertIDs)), ",")
		args := make([]any, 0, len(block.CertIDs))
		for _, id := range block.CertIDs {
			args = append(args, id)
		}
		rows, err := l.db.Query(`SELECT `+anchorColumns+` FROM chain_anchors WHERE id IN (`+placeholders+`)`, args...)
		if err != nil {
			return Block{}, nil, err
		}
		defer rows.Close()
		if anchors, err = l.collectAnchors(rows); err != nil {
			return Block{}, nil, err
		}
	}
	return block, anchors, nil
}

// AllBlocks streams the whole chain in index order for replay verification.
func (l *Ledger) AllBlocks() ([]Block, error) {
	rows, err := l.db.Query(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	blocks := make([]Block, 0)
	for rows.Next() {
		block, err := l.scanBlock(rows)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, block)
	}
	return blocks, rows.Err()
}

func (l *Ledger) ChainInfo() (ChainInfoResult, error) {
	info := ChainInfoResult{ProofMode: l.cfg.ProofMode, Difficulty: l.cfg.Difficulty}
	if l.cfg.ProofMode == ProofModeSim {
		info.Difficulty = 0
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_blocks`).Scan(&info.Height); err != nil {
		return info, err
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors`).Scan(&info.TotalAnchors); err != nil {
		return info, err
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE block_id IS NULL`).Scan(&info.PendingAnchors); err != nil {
		return info, err
	}
	if info.Height > 0 {
		var genesisHash, tipHash string
		if err := l.db.QueryRow(`SELECT hash FROM chain_blocks WHERE block_index = 0`).Scan(&genesisHash); err != nil {
			return info, err
		}
		if err := l.db.QueryRow(`SELECT hash FROM chain_blocks ORDER BY block_index DESC LIMIT 1`).Scan(&tipHash); err != nil {
			return info, err
		}
		info.GenesisHash = genesisHash
		info.TipHash = tipHash
	}
	if key, err := l.EnsureSiteKey(); err == nil {
		info.SitePublicKey = key.PublicKey
	}
	return info, nil
}

// Wake nudges the miner loop; never blocks, never drops work.
func (l *Ledger) Wake() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}
