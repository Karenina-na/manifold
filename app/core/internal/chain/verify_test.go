package chain

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func contextWithCancel() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}

func TestReplayDetectsTamperedBlockHash(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	a1, err := ledger.Submit("content", []byte("p1"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	_ = a1
	// Flip a historical block's difficulty: because proofMode and difficulty
	// participate in the hash pre-image, the stored hash no longer matches.
	if _, err := ledger.db.Exec(`UPDATE chain_blocks SET difficulty = 5 WHERE block_index = 1`); err != nil {
		t.Fatal(err)
	}
	report, err := ledger.ReplayVerify()
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("difficulty tamper must break replay")
	}
}

func TestReplayDetectsTamperedCertificate(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	a1, err := ledger.Submit("content", []byte("p1"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.db.Exec(`UPDATE chain_anchors SET subject_hash = ? WHERE id = ?`, SubjectHashHex([]byte("evil")), a1.ID); err != nil {
		t.Fatal(err)
	}
	report, err := ledger.ReplayVerify()
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("certificate tamper must break signature verification")
	}
}

func TestReplayDetectsBrokenLinkage(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	if _, err := ledger.Submit("visitor", []byte("x"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	// Rewire a mid-chain prev hash; the recomputed linkage check must catch it.
	if _, err := ledger.db.Exec(`UPDATE chain_blocks SET prev_hash = ? WHERE block_index = 1`, SubjectHashHex([]byte("fake"))); err != nil {
		t.Fatal(err)
	}
	report, err := ledger.ReplayVerify()
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("prev-hash tamper must break replay")
	}
}

func TestMinerPacksWhenBatchReached(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 3
		cfg.FlushTimeout = time.Hour
	})
	for i := 0; i < 3; i++ {
		if _, err := ledger.Submit("visitor", []byte(fmt.Sprintf("p%d", i)), "", "", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount()
	if err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("batch full must pack, pending=%d", pending)
	}
}

func TestMinerRespectsFlushTimeout(t *testing.T) {
	// FlushTimeout 0 → the oldest pending is always overdue → immediate pack.
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 100
		cfg.FlushTimeout = 0
	})
	if _, err := ledger.Submit("visitor", []byte("lone"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount()
	if err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatal("flush timeout must pack a lone overdue anchor")
	}
}

func TestMinerHoldsBelowThresholdAndNotDue(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 100
		cfg.FlushTimeout = time.Hour
	})
	if _, err := ledger.Submit("visitor", []byte("early"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount()
	if err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatal("below batch size and not overdue must stay pending")
	}
}

func TestMinerMintsGenesisOnEmptyChain(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = time.Hour })
	// Empty buffer: MineOnce still mints genesis (docs/chain.md §9).
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	info, err := ledger.ChainInfo()
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 1 {
		t.Fatalf("genesis must exist after first pass, height=%d", info.Height)
	}
}

func TestMinerPacksRemainderBeyondMaxBlockAnchors(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 3
		cfg.MaxBlockAnchors = 2
		cfg.FlushTimeout = time.Hour
	})
	for i := 0; i < 3; i++ {
		if _, err := ledger.Submit("visitor", []byte(fmt.Sprintf("p%d", i)), "", "", nil); err != nil {
			t.Fatal(err)
		}
	}
	// First pass mints genesis; PendingAnchors caps at MaxBlockAnchors, so one
	// anchor remains buffered. The remainder sits below BatchSize and is not
	// overdue, so it stays pending — exactly the flush-timeout contract.
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount()
	if err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("block cap must leave remainder pending, got %d", pending)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if pending, _ = ledger.PendingCount(); pending != 1 {
		t.Fatalf("below-batch remainder must wait for flush timeout, got %d", pending)
	}
	// Once the oldest pending is overdue, the next pass packs it.
	ledger.cfg.FlushTimeout = 0
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if pending, _ = ledger.PendingCount(); pending != 0 {
		t.Fatalf("overdue remainder must pack, got %d", pending)
	}
	report, err := ledger.ReplayVerify()
	if err != nil {
		t.Fatal(err)
	}
	if !report.Intact {
		t.Fatalf("split chain must replay intact, problems: %v", report.Problems)
	}
}

func TestRunStopsOnContextCancel(t *testing.T) {
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	ctx, cancel := contextWithCancel()
	cancel()
	if err := ledger.Run(ctx, RunOptions{}); err == nil {
		t.Fatal("cancelled context must stop the miner")
	}
}
