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
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return NewLedger(s.DB, testConfig(nil)), s
}

func newLedgerWithKey(t *testing.T, mutate func(*LedgerConfig)) *Ledger {
	t.Helper()
	ledger, _ := newLedgerDB(t)
	if mutate != nil {
		ledger.cfg = testConfig(mutate)
	}
	if _, err := ledger.EnsureSiteKey(); err != nil {
		t.Fatal(err)
	}
	return ledger
}

func TestEnsureSiteKeyIsIdempotent(t *testing.T) {
	ledger := newLedgerWithKey(t, nil)
	key1, err := ledger.EnsureSiteKey()
	if err != nil {
		t.Fatal(err)
	}
	key2, err := ledger.EnsureSiteKey()
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
	ledger := newLedgerWithKey(t, nil)
	anchor, err := ledger.Submit("content", []byte(`{"slug":"a"}`), "", "", map[string]any{"contentId": "content_1", "status": "PUBLISHED"})
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
	pending, err := ledger.PendingAnchors()
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending: %v %v", pending, err)
	}
	if pending[0].Metadata["contentId"] != "content_1" {
		t.Fatalf("metadata not persisted: %v", pending[0].Metadata)
	}
}

func TestSubmitRejectsUnknownSource(t *testing.T) {
	ledger := newLedgerWithKey(t, nil)
	if _, err := ledger.Submit("nonsense", []byte("x"), "", "", nil); err == nil {
		t.Fatal("unknown source must be rejected")
	}
}

func TestInsertBlockCreatesGenesisThenBackfills(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0 })
	a1, err := ledger.Submit("content", []byte("p1"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	a2, err := ledger.Submit("visitor", []byte("p2"), "hello", "", nil)
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
		anchor, err := ledger.GetAnchor(id)
		if err != nil {
			t.Fatal(err)
		}
		if anchor.BlockID != block.ID {
			t.Fatalf("anchor %s not backfilled", id)
		}
	}
	report, err := ledger.ReplayVerify()
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
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.ProofMode = ProofModeProof
		cfg.Difficulty = 1
		cfg.SimDelay = 0
	})
	if _, err := ledger.InsertBlock(nil); err != nil {
		t.Fatal(err)
	}
	a, err := ledger.Submit("visitor", []byte("pow"), "", "", nil)
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
	ledger := newLedgerWithKey(t, nil)
	if _, err := ledger.Submit("content", []byte("c1"), "", "content_1", map[string]any{"contentId": "content_1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.Submit("visitor", []byte("v1"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.Submit("content", []byte("c2"), "", "content_2", map[string]any{"contentId": "content_2"}); err != nil {
		t.Fatal(err)
	}
	items, total, err := ledger.ListAnchors(AnchorListOptions{Source: "content", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("source filter: total=%d items=%d", total, len(items))
	}
	if items[0].SubjectRef != "content_2" && items[0].SubjectRef != "content_1" {
		t.Fatalf("unexpected ref: %s", items[0].SubjectRef)
	}
	refItems, total, err := ledger.ListAnchors(AnchorListOptions{Ref: "content_1", Page: 1, PageSize: 10})
	if err != nil || total != 1 || len(refItems) != 1 {
		t.Fatalf("ref filter: %v %d %v", refItems, total, err)
	}
}

func TestChainInfoCounts(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	if _, err := ledger.Submit("visitor", []byte("x"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	info, err := ledger.ChainInfo()
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 0 || info.TotalAnchors != 1 || info.PendingAnchors != 1 {
		t.Fatalf("pre-mining info: %+v", info)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	info, err = ledger.ChainInfo()
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 2 || info.TotalAnchors != 1 || info.PendingAnchors != 0 {
		t.Fatalf("post-mining info: %+v", info)
	}
}

func TestMetadataJSONRoundTrip(t *testing.T) {
	ledger := newLedgerWithKey(t, nil)
	anchor, err := ledger.Submit("comment", []byte("m"), "", "", map[string]any{"commentId": "comment_1", "action": "created", "version": 2})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := ledger.GetAnchor(anchor.ID)
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
	ledger := newLedgerWithKey(t, nil)

	comment, err := ledger.Submit("comment", []byte("m"), "", "comment_1", map[string]any{"commentId": "comment_1", "contentId": "content_9", "action": "created"})
	if err != nil {
		t.Fatal(err)
	}
	if comment.SubjectRef != "comment_1" {
		t.Fatalf("comment ref must be the commentId, got %q", comment.SubjectRef)
	}

	reaction, err := ledger.Submit("reaction", []byte("r"), "", "", map[string]any{"contentId": "content_9", "action": "added"})
	if err != nil {
		t.Fatal(err)
	}
	if reaction.SubjectRef != "" {
		t.Fatalf("reaction ref must be empty, got %q", reaction.SubjectRef)
	}

	profile, err := ledger.Submit("profile", []byte("p"), "", "profile_1", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if profile.SubjectRef != "profile_1" {
		t.Fatalf("profile ref must be profile_1, got %q", profile.SubjectRef)
	}

	stored, err := ledger.GetAnchor(comment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SubjectRef != "comment_1" {
		t.Fatalf("persisted comment ref must be commentId, got %q", stored.SubjectRef)
	}
}
