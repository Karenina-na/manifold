package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/handler"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load configuration", "error", err)
		os.Exit(1)
	}

	database, err := store.Open(cfg.DatabasePath)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	router, closeRouter := handler.RouterWithLifecycle(cfg, database)
	defer closeRouter()

	server := &http.Server{Addr: cfg.Addr, Handler: router, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("core listening", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server stopped", "error", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}
