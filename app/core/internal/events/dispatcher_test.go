package events

import (
	"sync"
	"testing"
	"time"
)

func TestDispatcherDeliversQueuedEventsBeforeClose(t *testing.T) {
	var mu sync.Mutex
	var received []AuditEvent
	dispatcher := NewAuditDispatcher(2, func(event AuditEvent) {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, event)
	})

	if !dispatcher.Publish(AuditEvent{EventName: "content.created", ResourceID: "content_1"}) {
		t.Fatal("expected first event to be accepted")
	}
	if !dispatcher.Publish(AuditEvent{EventName: "content.published", ResourceID: "content_1"}) {
		t.Fatal("expected second event to be accepted")
	}
	dispatcher.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 2 {
		t.Fatalf("expected two delivered events, got %d", len(received))
	}
}

func TestDispatcherReportsQueueOverflow(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	dispatcher := NewAuditDispatcher(1, func(AuditEvent) {
		startOnce.Do(func() { close(started) })
		<-release
	})
	defer dispatcher.Close()

	if !dispatcher.Publish(AuditEvent{EventName: "first"}) {
		t.Fatal("expected first event to be accepted")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("dispatcher did not start consuming")
	}
	if !dispatcher.Publish(AuditEvent{EventName: "second"}) {
		t.Fatal("expected buffered event to be accepted")
	}
	if dispatcher.Publish(AuditEvent{EventName: "third"}) {
		t.Fatal("expected full queue to reject the third event")
	}
	close(release)
}

func TestDispatcherAcceptsNilHandler(t *testing.T) {
	dispatcher := NewAuditDispatcher(1, nil)
	if !dispatcher.Publish(AuditEvent{EventName: "content.created"}) {
		t.Fatal("expected event to be accepted")
	}
	dispatcher.Close()
}

func TestDispatcherCloseWithTimeoutReturnsWhenHandlerBlocks(t *testing.T) {
	release := make(chan struct{})
	dispatcher := NewAuditDispatcher(1, func(AuditEvent) { <-release })
	if !dispatcher.Publish(AuditEvent{EventName: "content.created"}) {
		t.Fatal("expected event to be accepted")
	}
	if dispatcher.CloseWithTimeout(time.Millisecond) {
		t.Fatal("expected close to report an undrained worker")
	}
	close(release)
	if !dispatcher.CloseWithTimeout(time.Second) {
		t.Fatal("expected the worker to drain after release")
	}
}
