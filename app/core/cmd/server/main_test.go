package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

func TestRunDoesNotOpenDatabaseWhenAddressIsInUse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	databasePath := filepath.Join(t.TempDir(), "manifold.db")
	err = run(context.Background(), config.Config{
		Addr:         listener.Addr().String(),
		DatabasePath: databasePath,
	})
	if err == nil {
		t.Fatal("expected startup to fail while the address is in use")
	}
	if _, statErr := os.Stat(databasePath); !os.IsNotExist(statErr) {
		t.Fatalf("database should not be opened before the listener is acquired: %v", statErr)
	}
}
