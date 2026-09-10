package handler

import (
	"context"
	"testing"
	"time"
)

func TestMinerLifecycleCloseWaitsForRunExit(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	miner := startMiner(func(ctx context.Context) {
		close(started)
		<-ctx.Done()
		<-release
	})
	<-started

	closed := make(chan struct{})
	go func() {
		miner.Close()
		close(closed)
	}()

	select {
	case <-closed:
		t.Fatal("Close returned before the miner goroutine exited")
	case <-time.After(20 * time.Millisecond):
	}

	close(release)
	select {
	case <-closed:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Close did not return after the miner goroutine exited")
	}
}
