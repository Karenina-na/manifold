package conversation

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const maxStoredMessagesPerSession = 200

type VolatileHistory struct {
	mu       sync.RWMutex
	messages map[string][]Message
	sequence atomic.Uint64
	now      func() time.Time
}

func NewVolatileHistory() *VolatileHistory {
	return &VolatileHistory{messages: map[string][]Message{}, now: time.Now}
}

func (h *VolatileHistory) Clear(_ context.Context, sessionID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.messages, sessionID)
	return nil
}

func (h *VolatileHistory) List(_ context.Context, sessionID string, limit int) ([]Message, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	items := h.messages[sessionID]
	start := 0
	if limit > 0 && len(items) > limit {
		start = len(items) - limit
	}
	result := make([]Message, len(items)-start)
	copy(result, items[start:])
	return result, nil
}

func (h *VolatileHistory) Append(_ context.Context, sessionID string, message Message) (Message, error) {
	if sessionID == "" {
		return Message{}, fmt.Errorf("session id is required")
	}
	if message.ID == "" {
		message.ID = fmt.Sprintf("msg_%d", h.sequence.Add(1))
	}
	if message.CreatedAt.IsZero() {
		message.CreatedAt = h.now().UTC()
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.messages[sessionID] = append(h.messages[sessionID], message)
	if overflow := len(h.messages[sessionID]) - maxStoredMessagesPerSession; overflow > 0 {
		h.messages[sessionID] = append([]Message(nil), h.messages[sessionID][overflow:]...)
	}
	return message, nil
}

func (h *VolatileHistory) Undo(_ context.Context, sessionID, messageID string) (Message, []Message, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	items := h.messages[sessionID]
	for index, message := range items {
		if message.ID != messageID {
			continue
		}
		if message.Role != "user" {
			return Message{}, nil, ErrMessageNotUser
		}
		remaining := append([]Message(nil), items[:index]...)
		h.messages[sessionID] = remaining
		return message, append([]Message(nil), remaining...), nil
	}
	return Message{}, nil, ErrMessageNotFound
}
