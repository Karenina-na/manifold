package chain

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func contextWithCancel() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}

func TestReplayDetectsTamperedBlockHash(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	a1, err := ledger.Submit(ctx, "content", []byte("p1"), "", "", nil)
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
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("difficulty tamper must break replay")
	}
}

func TestReplayDetectsTamperedCertificate(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	a1, err := ledger.Submit(ctx, "content", []byte("p1"), "", "", nil)
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
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("certificate tamper must break signature verification")
	}
}

func TestReplayDetectsBrokenLinkage(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	if _, err := ledger.Submit(ctx, "visitor", []byte("x"), "", "", nil); err != nil {
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
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if report.Intact {
		t.Fatal("prev-hash tamper must break replay")
	}
}

// TestProofBlockTimestampFrozenBeforePoW pins the C1 regression: the block
// timestamp is part of the hash pre-image, so it is sampled exactly once while
// the header is assembled and never rewritten after the collision search. The
// injected clock advances one second per read, so a post-PoW rewrite would
// both burn an extra read and leave a stored hash whose nonce no longer meets
// the block's difficulty — which full-chain replay reports as a tampered block.
func TestProofBlockTimestampFrozenBeforePoW(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.ProofMode = ProofModeProof
		cfg.Difficulty = 2
		cfg.SimDelay = 0
		cfg.FlushTimeout = 0
	})
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	reads := 0
	ledger.now = func() time.Time {
		reads++
		return base.Add(time.Duration(reads) * time.Second)
	}

	if _, err := ledger.InsertBlock(nil); err != nil {
		t.Fatal(err)
	}
	anchor, err := ledger.Submit(ctx, "visitor", []byte("pow-timestamp"), "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ledger.InsertBlock([]string{anchor.ID})
	if err != nil {
		t.Fatal(err)
	}

	if reads != 2 {
		t.Fatalf("clock must be read once per block (2 blocks mined), got %d reads", reads)
	}
	if want := base.Add(2 * time.Second).Format(time.RFC3339); block.Timestamp != want {
		t.Fatalf("stored timestamp %q must be the pre-PoW sample %q", block.Timestamp, want)
	}
	if !HasLeadingZeros(block.Hash, 2) {
		t.Fatalf("stored hash must still meet difficulty 2: %s", block.Hash)
	}
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Intact {
		t.Fatalf("proof chain must replay intact, problems: %v", report.Problems)
	}
}

func TestMinerPacksWhenBatchReached(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 3
		cfg.FlushTimeout = time.Hour
	})
	for i := 0; i < 3; i++ {
		if _, err := ledger.Submit(ctx, "visitor", []byte(fmt.Sprintf("p%d", i)), "", "", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("batch full must pack, pending=%d", pending)
	}
}

func TestMinerRespectsFlushTimeout(t *testing.T) {
	ctx := t.Context()
	// FlushTimeout 0 → the oldest pending is always overdue → immediate pack.
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 100
		cfg.FlushTimeout = 0
	})
	if _, err := ledger.Submit(ctx, "visitor", []byte("lone"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatal("flush timeout must pack a lone overdue anchor")
	}
}

func TestMinerHoldsBelowThresholdAndNotDue(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 100
		cfg.FlushTimeout = time.Hour
	})
	if _, err := ledger.Submit(ctx, "visitor", []byte("early"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatal("below batch size and not overdue must stay pending")
	}
}

func TestMinerMintsGenesisOnEmptyChain(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = time.Hour })
	// Empty buffer: MineOnce still mints genesis (docs/chain.md §9).
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	info, err := ledger.ChainInfo(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.Height != 1 {
		t.Fatalf("genesis must exist after first pass, height=%d", info.Height)
	}
}

func TestMinerPacksRemainderBeyondMaxBlockAnchors(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.SimDelay = 0
		cfg.BatchSize = 3
		cfg.MaxBlockAnchors = 2
		cfg.FlushTimeout = time.Hour
	})
	for i := 0; i < 3; i++ {
		if _, err := ledger.Submit(ctx, "visitor", []byte(fmt.Sprintf("p%d", i)), "", "", nil); err != nil {
			t.Fatal(err)
		}
	}
	// First pass mints genesis; PendingAnchors caps at MaxBlockAnchors, so one
	// anchor remains buffered. The remainder sits below BatchSize and is not
	// overdue, so it stays pending — exactly the flush-timeout contract.
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	pending, err := ledger.PendingCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("block cap must leave remainder pending, got %d", pending)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if pending, _ = ledger.PendingCount(ctx); pending != 1 {
		t.Fatalf("below-batch remainder must wait for flush timeout, got %d", pending)
	}
	// Once the oldest pending is overdue, the next pass packs it.
	ledger.cfg.FlushTimeout = 0
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if pending, _ = ledger.PendingCount(ctx); pending != 0 {
		t.Fatalf("overdue remainder must pack, got %d", pending)
	}
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Intact {
		t.Fatalf("split chain must replay intact, problems: %v", report.Problems)
	}
}

func TestRunStopsOnContextCancel(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	ctx, cancel := contextWithCancel()
	cancel()
	if err := ledger.Run(ctx, RunOptions{}); err == nil {
		t.Fatal("cancelled context must stop the miner")
	}
}

// TestRunCancelsAnInFlightProofSearch asserts that a proof search already
// running is stopped by ctx cancellation, not merely that Run notices an
// already-cancelled context — TestRunStopsOnContextCancel covers that.
//
// The distinction needs the search to be provably in flight before cancelling.
// A fixed `time.Sleep(10ms)` was used for this and could elapse before the
// goroutine reached the loop, at which point the test still passed while
// asserting nothing beyond what the other test already covers. The wait is now
// on the miner's own signal that the loop started.
func TestRunCancelsAnInFlightProofSearch(t *testing.T) {
	ctx := t.Context()
	started := make(chan struct{})
	var once sync.Once
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) {
		cfg.ProofMode = ProofModeProof
		// 64 hex digits of leading zeros never collide, so the search runs until
		// it is cancelled. newLedgerWithKey assigns cfg directly and so bypasses
		// the constructor's difficulty clamp, which is what keeps this reachable.
		cfg.Difficulty = 64
		cfg.FlushTimeout = 0
		cfg.OnProofSearchStart = func() { once.Do(func() { close(started) }) }
	})
	ctx, cancel := contextWithCancel()
	done := make(chan error, 1)
	go func() {
		done <- ledger.Run(ctx, RunOptions{})
	}()

	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the proof search never started, so nothing was in flight to cancel")
	}
	cancel()

	// The loop re-reads ctx every 1024 nonces (~0.2ms at the measured rate), so
	// this bound only distinguishes "stopped" from "hung"; it is not a margin
	// the test races against.
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context cancellation, got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("in-flight proof search did not stop after context cancellation")
	}
}

// ReplayVerify is the expensive path: it walks every block and re-verifies every
// certificate signature. Threading the caller's context through it means a
// verify request whose client has gone away stops at the transaction boundary
// instead of replaying the whole chain for nobody.
func TestReplayVerifyStopsOnCancelledContext(t *testing.T) {
	ctx := t.Context()
	ledger := newLedgerWithKey(t, func(cfg *LedgerConfig) { cfg.SimDelay = 0; cfg.FlushTimeout = 0 })
	if _, err := ledger.Submit(ctx, "content", []byte("p1"), "", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.MineOnce(); err != nil {
		t.Fatal(err)
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := ledger.ReplayVerify(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("ReplayVerify with a cancelled context: got %v, want context.Canceled", err)
	}
}
