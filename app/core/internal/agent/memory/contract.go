package memory

import (
	"context"
	"errors"
	"strings"
)

var ErrItemNotFound = errors.New("memory item not found")

type Store interface {
	Search(ctx context.Context, sessionID, query string) ([]Item, error)
	Add(ctx context.Context, sessionID, content string) (Item, error)
	Update(ctx context.Context, sessionID, itemID, content string) (Item, error)
	Delete(ctx context.Context, sessionID, itemID string) error
	Clear(ctx context.Context, sessionID string) error
}

type sessionContextKey struct{}

func BindSession(ctx context.Context, sessionID string) context.Context {
	return context.WithValue(ctx, sessionContextKey{}, strings.TrimSpace(sessionID))
}

func SessionID(ctx context.Context) (string, error) {
	sessionID, _ := ctx.Value(sessionContextKey{}).(string)
	if sessionID == "" {
		return "", errors.New("memory session is not bound")
	}
	return sessionID, nil
}
