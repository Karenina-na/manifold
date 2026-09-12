package handler

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type minerLifecycle struct {
	cancel context.CancelFunc
	done   <-chan struct{}
}

func startMiner(run func(context.Context)) *minerLifecycle {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		run(ctx)
	}()
	return &minerLifecycle{cancel: cancel, done: done}
}

func (m *minerLifecycle) Close() {
	m.cancel()
	<-m.done
}

func startChainMiner(h *apiHandler, database *store.Store, ledger *chain.Ledger) *minerLifecycle {
	if ledger == nil {
		return nil
	}
	return startMiner(func(minerCtx context.Context) {
		if err := ledger.Run(minerCtx, chain.RunOptions{
			OnMined: func(block chain.Block, minedFor time.Duration) {
				// Audit chain.block.mined per docs/chain.md §9 (index, cert
				// count, nonce, mode, duration); the miner has no request
				// context, so publish directly through the dispatcher and read
				// the rows this callback needs under the miner's own lifetime
				// context — a shutdown that cancels the miner also stops them.
				if h.auditEvents != nil {
					h.auditEvents.Publish(events.AuditEvent{
						EventName: "chain.block.mined", ResourceType: "chain_block", ResourceID: block.ID,
						Actor: "chain-miner",
						Metadata: map[string]string{"index": strconv.Itoa(block.Index), "certCount": strconv.Itoa(len(block.CertIDs)),
							"nonce": strconv.Itoa(block.Nonce), "proofMode": string(block.ProofMode), "durationMs": strconv.FormatInt(minedFor.Milliseconds(), 10)},
					})
				}
				for _, certID := range block.CertIDs {
					anchor, err := ledger.GetAnchor(minerCtx, certID)
					if err != nil {
						continue
					}
					if anchor.Source == chain.SourceContent {
						if slug, ok := anchor.Metadata["slug"].(string); ok && slug != "" {
							h.contentCache.Remove(slug)
							if content, err := database.GetContentByID(minerCtx, anchor.SubjectRef, true); err == nil {
								h.contentCache.Remove(content.Slug)
							}
						}
					}
				}
			},
			OnCrashed: func(err error) {
				slog.Error("chain_miner_crashed", "error", err)
				if h.auditEvents != nil {
					h.auditEvents.Publish(events.AuditEvent{
						EventName: "chain.miner.crashed", ResourceType: "chain_miner", ResourceID: "miner", Actor: "chain-miner",
						Metadata: map[string]string{"error": err.Error()},
					})
				}
			},
		}); err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("chain_miner_stopped", "error", err)
		}
	})
}
