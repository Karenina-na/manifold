package conversation

import (
	"context"
	"errors"
	"time"
)

var (
	ErrMessageNotFound       = errors.New("message not found")
	ErrMessageNotUser        = errors.New("message is not a user message")
	ErrSummaryBoundaryAbsent = errors.New("summary boundary message not found")
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
	Sequence  uint64        `json:"-"`
}

type Summary struct {
	Content           string
	ThroughSequence   uint64
	AnchorSequence    uint64
	CompactedMessages int
	RecentTurns       int
}

type Snapshot struct {
	Messages []Message
	Summary  Summary
}

type History interface {
	List(ctx context.Context, sessionID string, limit int) ([]Message, error)
	Snapshot(ctx context.Context, sessionID string) (Snapshot, error)
	Append(ctx context.Context, sessionID string, message Message) (Message, error)
	SaveSummary(ctx context.Context, sessionID string, summary Summary) error
	Clear(ctx context.Context, sessionID string) error
	Undo(ctx context.Context, sessionID, messageID string) (Message, []Message, error)
}
