package chain

import (
	"database/sql"
	"errors"
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
	db   *sql.DB
	cfg  LedgerConfig
	wake chan struct{}
	// now is the ledger clock, read exactly once per block when the header is
	// assembled. The header timestamp is part of the PoW pre-image, so it must
	// be frozen before the collision search starts and never rewritten after
	// (docs/chain.md §3.4). Injectable so tests can pin block time.
	now func() time.Time
}
