package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/handler"
	"github.com/manifold-space/manifold/app/core/internal/seed"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, cfg); err != nil {
		slog.Error("run core", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config.Config) error {
	plan, err := seed.Resolve(cfg.Env, cfg.SeedFile)
	if err != nil {
		return fmt.Errorf("resolve seed: %w", err)
	}
	slog.Info("seed plan resolved", "env", cfg.Env, "seedFile", cfg.SeedFile, "contents", len(plan.Contents))

	listener, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Addr, err)
	}
	defer listener.Close()

	database, err := store.Open(cfg.DatabasePath, store.WithSeedPlan(plan), store.WithAdminCredential(cfg.AdminUsername, cfg.AdminPasswordHash))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer database.Close()

	// The anchoring ledger shares the SQLite handle; its miner goroutine is
	// started inside RouterWithLifecycle and stops before audit drain.
	ledger := chain.NewLedger(database.DB, chain.LedgerConfig{
		ProofMode:       chain.ProofMode(cfg.ChainProofMode),
		Difficulty:      cfg.ChainDifficulty,
		SimDelay:        cfg.ChainSimDelay,
		BatchSize:       cfg.ChainBatchSize,
		MaxBlockAnchors: cfg.ChainMaxBlockAnchors,
		FlushTimeout:    cfg.ChainFlushTimeout,
		AnchorMaxBytes:  cfg.ChainAnchorMaxBytes,
	})
	if _, err := ledger.EnsureSiteKey(); err != nil {
		return fmt.Errorf("ensure chain site key: %w", err)
	}
	if err := seedAnchorsForDevContents(ledger, database); err != nil {
		return fmt.Errorf("seed content anchors: %w", err)
	}

	router, closeRouter := handler.RouterWithLifecycle(cfg, database, ledger)
	defer closeRouter()

	server := &http.Server{Addr: cfg.Addr, Handler: router, ReadHeaderTimeout: 5 * time.Second}
	serverError := make(chan error, 1)
	go func() {
		slog.Info("core listening", "addr", listener.Addr().String())
		serverError <- server.Serve(listener)
	}()

	select {
	case err := <-serverError:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve core: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shut down core: %w", err)
	}
	if err := <-serverError; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve core: %w", err)
	}
	return nil
}

// seedAnchorsForDevContents commits PUBLISHED/v1 certificates for freshly
// seeded demo contents so a brand-new database opens with a demonstrable
// chain (docs/chain.md §4.1 seed rule). The trigger is an empty chain — a
// fresh database or the first boot with chain enabled — so every currently
// published row gets its opening certificate; rows written later carry
// certificates from their own write paths. Production skeletons have no
// content rows, making this a no-op there.
func seedAnchorsForDevContents(ledger *chain.Ledger, database *store.Store) error {
	existing, err := ledger.AnchorCount()
	if err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	contents, err := database.PublishedContents()
	if err != nil {
		return err
	}
	for _, content := range contents {
		// The seed path shares application.ContentPayload — the certificate
		// format is defined once (docs/chain.md §4.1 seed rule).
		payload, _, subjectRef, metadata, err := application.ContentPayload(content)
		if err != nil {
			return err
		}
		if _, err := ledger.Submit(chain.SourceContent, payload, "", subjectRef, metadata); err != nil {
			return err
		}
	}
	return nil
}
