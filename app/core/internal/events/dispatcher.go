package events

import (
	"sync"
	"time"
)

type AuditEvent struct {
	EventName    string
	ResourceType string
	ResourceID   string
	Actor        string
	RequestID    string
	TraceID      string
	Metadata     map[string]string
}

type AuditPublisher interface {
	Publish(AuditEvent) bool
}

type SynchronousAuditPublisher struct {
	onEvent func(AuditEvent)
}

func NewSynchronousAuditPublisher(onEvent func(AuditEvent)) *SynchronousAuditPublisher {
	return &SynchronousAuditPublisher{onEvent: onEvent}
}

func (p *SynchronousAuditPublisher) Publish(event AuditEvent) bool {
	if p.onEvent != nil {
		p.onEvent(event)
	}
	return true
}

type AuditDispatcher struct {
	queue     chan AuditEvent
	onEvent   func(AuditEvent)
	closeMu   sync.RWMutex
	closed    bool
	drained   bool
	closeOnce sync.Once
	worker    sync.WaitGroup
	done      chan struct{}
}

func NewAuditDispatcher(buffer int, onEvent func(AuditEvent)) *AuditDispatcher {
	if buffer < 1 {
		buffer = 1
	}
	dispatcher := &AuditDispatcher{queue: make(chan AuditEvent, buffer), onEvent: onEvent, done: make(chan struct{})}
	dispatcher.worker.Add(1)
	go dispatcher.run()
	return dispatcher
}

func (d *AuditDispatcher) Publish(event AuditEvent) bool {
	d.closeMu.RLock()
	defer d.closeMu.RUnlock()
	if d.closed {
		return false
	}
	select {
	case d.queue <- event:
		return true
	default:
		return false
	}
}

func (d *AuditDispatcher) Close() {
	_ = d.CloseWithTimeout(5 * time.Second)
}

func (d *AuditDispatcher) CloseWithTimeout(timeout time.Duration) bool {
	d.closeOnce.Do(func() {
		d.closeMu.Lock()
		d.closed = true
		close(d.queue)
		d.closeMu.Unlock()
	})
	if timeout <= 0 {
		return false
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-d.done:
		d.closeMu.Lock()
		d.drained = true
		d.closeMu.Unlock()
	case <-timer.C:
	}
	d.closeMu.RLock()
	defer d.closeMu.RUnlock()
	return d.drained
}

func (d *AuditDispatcher) run() {
	defer d.worker.Done()
	defer close(d.done)
	for event := range d.queue {
		if d.onEvent != nil {
			d.onEvent(event)
		}
	}
}
