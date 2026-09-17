package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

var (
	ErrMessageNotFound = errors.New("message not found")
	ErrMessageNotUser  = errors.New("message is not a user message")
)

type MessageTrace struct {
	Steps        []TraceStep `json:"steps"`
	FinishReason string      `json:"finishReason"`
	Usage        TraceUsage  `json:"usage"`
}

type TraceStep struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Status  string `json:"status"`
	Name    string `json:"name,omitempty"`
	Input   any    `json:"input,omitempty"`
	Output  any    `json:"output,omitempty"`
	Message string `json:"message,omitempty"`
}

type TraceUsage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
	TotalTokens  int `json:"totalTokens"`
}

type Message struct {
	ID        string        `json:"id"`
	Role      string        `json:"role"`
	Content   string        `json:"content"`
	CreatedAt time.Time     `json:"-"`
	Trace     *MessageTrace `json:"trace,omitempty"`
}

type MessageRepository interface {
	List(ctx context.Context, sessionID string, limit int) ([]Message, error)
	Append(ctx context.Context, sessionID string, message Message) (Message, error)
}

type SessionMemory interface {
	MessageRepository
	Delete(ctx context.Context, sessionID string) error
	UndoTurn(ctx context.Context, sessionID, messageID string) (Message, []Message, error)
}

const maxStoredMessagesPerSession = 200

type Memory struct {
	mu       sync.RWMutex
	messages map[string][]Message
	sequence atomic.Uint64
	now      func() time.Time
}

func NewMemory() *Memory {
	return &Memory{messages: map[string][]Message{}, now: time.Now}
}

func (m *Memory) Delete(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.messages, sessionID)
	return nil
}

func (m *Memory) List(_ context.Context, sessionID string, limit int) ([]Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := m.messages[sessionID]
	start := 0
	if limit > 0 && len(items) > limit {
		start = len(items) - limit
	}
	result := make([]Message, len(items)-start)
	copy(result, items[start:])
	return result, nil
}

func (m *Memory) Append(_ context.Context, sessionID string, message Message) (Message, error) {
	if sessionID == "" {
		return Message{}, fmt.Errorf("session id is required")
	}
	if message.ID == "" {
		message.ID = fmt.Sprintf("msg_%d", m.sequence.Add(1))
	}
	if message.CreatedAt.IsZero() {
		message.CreatedAt = m.now().UTC()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages[sessionID] = append(m.messages[sessionID], message)
	if overflow := len(m.messages[sessionID]) - maxStoredMessagesPerSession; overflow > 0 {
		m.messages[sessionID] = append([]Message(nil), m.messages[sessionID][overflow:]...)
	}
	return message, nil
}

func (m *Memory) UndoTurn(_ context.Context, sessionID, messageID string) (Message, []Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := m.messages[sessionID]
	for index, message := range items {
		if message.ID != messageID {
			continue
		}
		if message.Role != "user" {
			return Message{}, nil, ErrMessageNotUser
		}
		remaining := append([]Message(nil), items[:index]...)
		m.messages[sessionID] = remaining
		return message, append([]Message(nil), remaining...), nil
	}
	return Message{}, nil, ErrMessageNotFound
}
