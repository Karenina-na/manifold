package chain

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// mineTick is how often the miner re-evaluates the buffer even without wake
// signals; wake shortens the latency, the tick guarantees progress.
const mineTick = time.Second

// minerRestartDelay is the backoff after a recovered panic before the loop
// resumes (docs/chain.md §9 crash self-healing).
const minerRestartDelay = 5 * time.Second

// MineOnce runs a single mining decision (docs/chain.md §9 decision order):
// an empty chain mints genesis immediately — and then keeps evaluating the
// buffer in the same round, so the first wake after genesis still packs due
// work; an empty buffer returns; the buffer packs when batch size is reached
// or the oldest anchor has waited past the flush timeout. The return value
// is the block actually mined in this pass, or the zero Block when nothing
// was due — OnMined hooks fire only on real production. Exposed for tests.
func (l *Ledger) MineOnce() (Block, error) {
	return l.MineOnceContext(context.Background())
}

// MineOnceContext performs one mining decision and permits shutdown to cancel
// an in-flight proof search or simulated delay.
func (l *Ledger) MineOnceContext(ctx context.Context) (Block, error) {
	if _, err := l.Tip(); err != nil {
		if errors.Is(err, ErrEmptyChain) {
			if block, err := l.InsertBlockContext(ctx, nil); err != nil {
				return Block{}, err
			} else if block.Index == 0 {
				// genesis minted — keep evaluating the buffer this round
				return l.mineDuePending(ctx)
			}
		} else {
			return Block{}, err
		}
	}
	return l.mineDuePending(ctx)
}

// mineDuePending packs the buffered set only when the batch threshold or the
// flush timeout is due; otherwise it returns the zero Block.
func (l *Ledger) mineDuePending(ctx context.Context) (Block, error) {
	count, err := l.PendingCount()
	if err != nil {
		return Block{}, err
	}
	if count == 0 {
		return Block{}, nil
	}
	oldest, err := l.OldestPendingAge()
	if err != nil {
		return Block{}, err
	}
	if count < l.cfg.BatchSize && oldest < l.cfg.FlushTimeout {
		return Block{}, nil
	}
	pending, err := l.PendingAnchors()
	if err != nil {
		return Block{}, err
	}
	if len(pending) == 0 {
		return Block{}, nil
	}
	ids := make([]string, 0, len(pending))
	for _, anchor := range pending {
		ids = append(ids, anchor.ID)
	}
	return l.InsertBlockContext(ctx, ids)
}

// RunOptions carries the production hooks the HTTP layer wires in: block-mined
// for audit + cache invalidation, crashed for the restart audit event. The
// duration reports the wall time spent mining that block.
type RunOptions struct {
	OnMined   func(Block, time.Duration)
	OnCrashed func(err error)
}

// Run drives the miner until ctx is cancelled: 1s ticks plus wake signals,
// panic recovery with restart, finishing the in-flight block on shutdown.
func (l *Ledger) Run(ctx context.Context, opts RunOptions) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := l.mineOnceRecovering(ctx, opts); err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			slog.Error("chain_miner_iteration_failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-l.wake:
		case <-time.After(mineTick):
		}
	}
}

// mineOnceRecovering isolates one iteration: a panic is converted to an error,
// audited through OnCrashed, and the loop restarts after the backoff. OnMined
// fires only when this pass actually produced a block.
func (l *Ledger) mineOnceRecovering(ctx context.Context, opts RunOptions) (returned error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			returned = panicError{recovered}
			slog.Error("chain_miner_crashed", "panic", recovered)
			if opts.OnCrashed != nil {
				opts.OnCrashed(returned)
			}
			l.restartBackoff(ctx)
		}
	}()
	started := time.Now()
	block, err := l.MineOnceContext(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		if errors.Is(err, ErrTipMoved) {
			// Another writer produced a block mid-mining (only tests and
			// external inserts race this single-miner setup); the next tick
			// re-evaluates against the new tip.
			return nil
		}
		if opts.OnCrashed != nil {
			opts.OnCrashed(err)
		}
		return err
	}
	if block.ID == "" {
		return nil
	}
	if opts.OnMined != nil {
		opts.OnMined(block, time.Since(started))
	}
	return nil
}

// restartBackoff pauses after a recovered panic before the loop resumes
// (docs/chain.md §9 crash self-healing); ctx cancellation ends it early.
func (l *Ledger) restartBackoff(ctx context.Context) {
	timer := time.NewTimer(minerRestartDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

type panicError struct{ value any }

func (p panicError) Error() string {
	return "miner panic: " + sprint(p.value)
}

func sprint(v any) string {
	if err, ok := v.(error); ok {
		return err.Error()
	}
	return "unexpected panic value"
}
