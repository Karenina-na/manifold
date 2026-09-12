package chain

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/store"
)

func testConfig(mutate func(*LedgerConfig)) LedgerConfig {
	cfg := LedgerConfig{ProofMode: ProofModeSim, Difficulty: 0, SimDelay: time.Second, BatchSize: 32, MaxBlockAnchors: 500, FlushTimeout: 30 * time.Second, AnchorMaxBytes: 1 << 16}
	if mutate != nil {
		mutate(&cfg)
	}
	return cfg
}

// newLedgerDB opens a fresh migrated database; the chain tables are created by
// the same migration set, so the shared *sql.DB is handed straight to Ledger.
func newLedgerDB(t *testing.T) (*Ledger, *store.Store) {
	t.Helper()
	ctx := t.Context()
	s, err := store.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return NewLedger(s.DB, testConfig(nil)), s
}

func newLedgerWithKey(t *testing.T, mutate func(*LedgerConfig)) *Ledger {
	t.Helper()
	ctx := t.Context()
	ledger, _ := newLedgerDB(t)
	if mutate != nil {
		ledger.cfg = testConfig(mutate)
	}
	if _, err := ledger.EnsureSiteKey(ctx); err != nil {
		t.Fatal(err)
	}
	return ledger
}

func TestEnsureSiteKeyIsIdempotent(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	key1, err := ledger.EnsureSiteKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	key2, err := ledger.EnsureSiteKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if key1.KeyID != key2.KeyID || key1.PublicKey != key2.PublicKey {
		t.Fatal("EnsureSiteKey must be idempotent")
	}
	if !VerifySubjectHash(key1.PublicKey, SubjectHashHex([]byte("x")), func() string {
		signature, err := SignSubjectHash(key1.PrivateKey, SubjectHashHex([]byte("x")))
		if err != nil {
			t.Fatal(err)
		}
		return signature
	}()) {
		t.Fatal("stored key pair must sign and verify")
	}
}

func TestSubmitPersistsPendingAnchor(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	anchor, err := ledger.Submit(ctx, "content", []byte(`{"slug":"a"}`), "", "", map[string]any{"contentId": "content_1", "status": "PUBLISHED"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(anchor.ID, "cert_") {
		t.Fatalf("anchor id must use cert_ prefix, got %s", anchor.ID)
	}
	if anchor.SubjectHash != SubjectHashHex([]byte(`{"slug":"a"}`)) {
		t.Fatal("subject hash mismatch")
	}
	if anchor.BlockID != "" {
		t.Fatal("new anchor must be pending")
	}
	if !VerifySubjectHash(anchor.SitePublicKey, anchor.SubjectHash, anchor.SiteSignature) {
		t.Fatal("site signature must verify")
	}
	pending, err := ledger.PendingAnchors(ctx)
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending: %v %v", pending, err)
	}
	if pending[0].Metadata["contentId"] != "content_1" {
		t.Fatalf("metadata not persisted: %v", pending[0].Metadata)
	}
}

func TestSubmitRejectsUnknownSource(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	if _, err := ledger.Submit(ctx, "nonsense", []byte("x"), "", "", nil); err == nil {
		t.Fatal("unknown source must be rejected")
	}
}

func TestInsertBlockCreatesGenesisThenBackfills(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0 })
	a1, err := ledger.Submit(ctx, "content", []byte("p1"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	a2, err := ledger.Submit(ctx, "visitor", []byte("p2"), "hello", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Genesis must be minted empty first; data blocks start at index 1.
	if _, err := ledger.InsertBlock([]string{a1.ID}); err == nil {
		t.Fatal("InsertBlock must refuse to carry certs into genesis")
	}
	genesis, err := ledger.InsertBlock(nil)
	if err != nil {
		t.Fatal(err)
	}
	if genesis.Index != 0 {
		t.Fatalf("genesis index must be 0, got %d", genesis.Index)
	}
	block, err := ledger.InsertBlock([]string{a1.ID, a2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if block.Index != 1 {
		t.Fatalf("first data block must follow genesis, got index %d", block.Index)
	}
	if len(block.CertIDs) != 2 || block.CertIDs[0] != a1.ID {
		t.Fatalf("cert ids mismatch: %v", block.CertIDs)
	}
	if block.CertRoot != MerkleRoot([]string{a1.ID, a2.ID}) {
		t.Fatal("cert root mismatch")
	}
	if block.ID != "block_1" {
		t.Fatalf("block id must be derived from index, got %s", block.ID)
	}
	for _, id := range []string{a1.ID, a2.ID} {
		anchor, err := ledger.GetAnchor(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if anchor.BlockID != block.ID {
			t.Fatalf("anchor %s not backfilled", id)
		}
	}
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Intact {
		t.Fatalf("fresh chain must replay intact, problems: %v", report.Problems)
	}
}

func TestInsertBlockGenesisStructure(t *testing.T) {
	ledger := newLedgerWithKey(t, nil)
	genesis, err := ledger.InsertBlock(nil)
	if err != nil {
		t.Fatal(err)
	}
	if genesis.Index != 0 || genesis.PrevHash != strings.Repeat("0", 64) {
		t.Fatalf("bad genesis: %+v", genesis)
	}
	if len(genesis.CertIDs) != 0 {
		t.Fatalf("genesis must carry no certs, got %v", genesis.CertIDs)
	}
	if genesis.CertRoot != MerkleRoot(nil) {
		t.Fatal("genesis cert root must be sha256(\"\")")
	}
}

func TestInsertBlockHandlesProofMode(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.ProofMode = ProofModeProof
		cfg.Difficulty = 1
		cfg.SimDelay = 0
	})
	if _, err := ledger.InsertBlock(nil); err != nil {
		t.Fatal(err)
	}
	a, err := ledger.Submit(ctx, "visitor", []byte("pow"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ledger.InsertBlock([]string{a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !HasLeadingZeros(block.Hash, 1) {
		t.Fatalf("proof block hash must meet difficulty 1: %s", block.Hash)
	}
	if block.Nonce == 0 && !HasLeadingZeros(block.Hash, 1) {
		t.Fatal("difficulty 1 with nonce 0 would be luck, still valid")
	}
}

func TestListAnchorsFiltersAndPaginates(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	if _, err := ledger.Submit(ctx, "content", []byte("c1"), "", "content_1", map[string]any{"contentId": "content_1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.Submit(ctx, "visitor", []byte("v1"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.Submit(ctx, "content", []byte("c2"), "", "content_2", map[string]any{"contentId": "content_2"}); err != nil {
		t.Fatal(err)
	}
	items, total, err := ledger.ListAnchors(ctx, AnchorListOptions{Source: "content", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("source filter: total=%d items=%d", total, len(items))
	}
	if items[0].SubjectRef != "content_2" && items[0].SubjectRef != "content_1" {
		t.Fatalf("unexpected ref: %s", items[0].SubjectRef)
	}
	refItems, total, err := ledger.ListAnchors(ctx, AnchorListOptions{Ref: "content_1", Page: 1, PageSize: 10})
	if err != nil || total != 1 || len(refItems) != 1 {
		t.Fatalf("ref filter: %v %d %v", refItems, total, err)
	}
}

func TestChainInfoCounts(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	if _, err := ledger.Submit(ctx, "visitor", []byte("x"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	info, err := ledger.ChainInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 0 || info.TotalAnchors != 1 || info.PendingAnchors != 1 {
		t.Fatalf("pre-mining info: %+v", info)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	info, err = ledger.ChainInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 2 || info.TotalAnchors != 1 || info.PendingAnchors != 0 {
		t.Fatalf("post-mining info: %+v", info)
	}
}

func TestMetadataJSONRoundTrip(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	anchor, err := ledger.Submit(ctx, "comment", []byte("m"), "", "", map[string]any{"commentId": "comment_1", "action": "created", "version": 2})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := ledger.GetAnchor(ctx, anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Metadata["commentId"] != "comment_1" || stored.Metadata["action"] != "created" {
		t.Fatalf("metadata mismatch: %v", stored.Metadata)
	}
	if version, ok := stored.Metadata["version"].(float64); !ok || version != 2 {
		t.Fatalf("numeric metadata must round trip as float64 via JSON, got %T %v", stored.Metadata["version"], stored.Metadata["version"])
	}
	raw, err := json.Marshal(stored.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"action":"created"`) {
		t.Fatalf("metadata serialization: %s", raw)
	}
}

// TestSubmitStoresExplicitSubjectRef pins the docs/chain.md §4.1 contract:
// subject_ref is the caller's explicit argument — a comment certificate
// references the commentId even though its metadata also carries a
// contentId, and sources without stable refs store the empty string.
func TestSubmitStoresExplicitSubjectRef(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)

	comment, err := ledger.Submit(ctx, "comment", []byte("m"), "", "comment_1", map[string]any{"commentId": "comment_1", "contentId": "content_9", "action": "created"})
	if err != nil {
		t.Fatal(err)
	}
	if comment.SubjectRef != "comment_1" {
		t.Fatalf("comment ref must be the commentId, got %q", comment.SubjectRef)
	}

	reaction, err := ledger.Submit(ctx, "reaction", []byte("r"), "", "", map[string]any{"contentId": "content_9", "action": "added"})
	if err != nil {
		t.Fatal(err)
	}
	if reaction.SubjectRef != "" {
		t.Fatalf("reaction ref must be empty, got %q", reaction.SubjectRef)
	}

	profile, err := ledger.Submit(ctx, "profile", []byte("p"), "", "profile_1", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if profile.SubjectRef != "profile_1" {
		t.Fatalf("profile ref must be profile_1, got %q", profile.SubjectRef)
	}

	stored, err := ledger.GetAnchor(ctx, comment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SubjectRef != "comment_1" {
		t.Fatalf("persisted comment ref must be commentId, got %q", stored.SubjectRef)
	}
}

// NewLedger is the boundary every caller goes through, so an out-of-range proof
// difficulty must be clamped there even when a caller skipped config.Validate
// (docs/chain.md §5). Without it the miner goroutine would run a collision
// search that only ends when the process shuts down.
func TestNewLedgerClampsProofDifficulty(t *testing.T) {
	ctx := t.Context()
	s, err := store.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, testCase := range []struct {
		name       string
		difficulty int
		want       int
	}{
		{"above the cap", 64, MaxProofDifficulty},
		{"below the floor", 0, MinProofDifficulty},
		{"inside the range", 3, 3},
	} {
		ledger := NewLedger(s.DB, testConfig(func(cfg *LedgerConfig) {
			cfg.ProofMode = ProofModeProof
			cfg.Difficulty = testCase.difficulty
		}))
		if ledger.cfg.Difficulty != testCase.want {
			t.Fatalf("%s: difficulty = %d, want %d", testCase.name, ledger.cfg.Difficulty, testCase.want)
		}
	}
}

// Sim mode never reads difficulty — mineHeader forces the target to 0 — so
// NewLedger must leave the value alone instead of clamping a setting the miner
// does not consult.
func TestNewLedgerLeavesSimDifficultyAlone(t *testing.T) {
	ctx := t.Context()
	s, err := store.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ledger := NewLedger(s.DB, testConfig(func(cfg *LedgerConfig) { cfg.Difficulty = 64 }))
	if ledger.cfg.Difficulty != 64 {
		t.Fatalf("sim difficulty = %d, want the configured 64", ledger.cfg.Difficulty)
	}
}

// GET /api/v1/chain is a read. ChainInfo used to call EnsureSiteKey, which
// INSERTs the site key when the row is missing, so the first GET on a fresh
// database created chain_keys as a side effect of a read.
func TestChainInfoDoesNotCreateTheSiteKey(t *testing.T) {
	ctx := t.Context()
	ledger, s := newLedgerDB(t)

	info, err := ledger.ChainInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.SitePublicKey != "" {
		t.Fatalf("a database without a site key must report an empty one, got %q", info.SitePublicKey)
	}
	var rows int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM chain_keys`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("ChainInfo wrote %d chain_keys row(s) from a read path", rows)
	}
}

// The counterpart: once the key exists, ChainInfo reports it. This is what the
// production path sees, because cmd/server ensures the key before serving.
func TestChainInfoReportsTheSiteKeyOnceItExists(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, nil)
	key, err := ledger.EnsureSiteKey(ctx)
	if err != nil {
		t.Fatal(err)
	}

	info, err := ledger.ChainInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.SitePublicKey != key.PublicKey {
		t.Fatalf("site public key = %q, want %q", info.SitePublicKey, key.PublicKey)
	}
}
