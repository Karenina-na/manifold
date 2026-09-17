package agent

import "context"

type Provider interface {
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)
}
