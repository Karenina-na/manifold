package memory

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type InMemory struct {
	mu       sync.RWMutex
	items    map[string][]Item
	sequence atomic.Uint64
	now      func() time.Time
}

func NewInMemory() *InMemory {
	return &InMemory{items: map[string][]Item{}, now: time.Now}
}

func (store *InMemory) Search(ctx context.Context, sessionID, query string) ([]Item, error) {
	if err := validateSession(ctx, sessionID); err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	store.mu.RLock()
	defer store.mu.RUnlock()
	items := store.items[sessionID]
	result := make([]Item, 0, len(items))
	for _, item := range items {
		if query == "" || strings.Contains(strings.ToLower(item.Content), query) {
			result = append(result, item)
		}
	}
	return result, nil
}

func (store *InMemory) Add(ctx context.Context, sessionID, content string) (Item, error) {
	if err := validateSession(ctx, sessionID); err != nil {
		return Item{}, err
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return Item{}, errors.New("memory content is required")
	}
	now := store.currentTime()
	item := Item{ID: fmt.Sprintf("memory_%d", store.sequence.Add(1)), Content: content, CreatedAt: now, UpdatedAt: now}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.ensureItems()
	store.items[sessionID] = append(store.items[sessionID], item)
	return item, nil
}

func (store *InMemory) Update(ctx context.Context, sessionID, itemID, content string) (Item, error) {
	if err := validateSession(ctx, sessionID); err != nil {
		return Item{}, err
	}
	itemID = strings.TrimSpace(itemID)
	content = strings.TrimSpace(content)
	if itemID == "" {
		return Item{}, errors.New("memory item id is required")
	}
	if content == "" {
		return Item{}, errors.New("memory content is required")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	for index := range store.items[sessionID] {
		if store.items[sessionID][index].ID != itemID {
			continue
		}
		store.items[sessionID][index].Content = content
		store.items[sessionID][index].UpdatedAt = store.currentTime()
		return store.items[sessionID][index], nil
	}
	return Item{}, ErrItemNotFound
}

func (store *InMemory) Delete(ctx context.Context, sessionID, itemID string) error {
	if err := validateSession(ctx, sessionID); err != nil {
		return err
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return errors.New("memory item id is required")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	items := store.items[sessionID]
	for index, item := range items {
		if item.ID != itemID {
			continue
		}
		store.items[sessionID] = append(items[:index], items[index+1:]...)
		return nil
	}
	return ErrItemNotFound
}

func (store *InMemory) Clear(ctx context.Context, sessionID string) error {
	if err := validateSession(ctx, sessionID); err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.items, sessionID)
	return nil
}

func (store *InMemory) currentTime() time.Time {
	now := store.now
	if now == nil {
		now = time.Now
	}
	return now().UTC()
}

func (store *InMemory) ensureItems() {
	if store.items == nil {
		store.items = map[string][]Item{}
	}
}

func validateSession(ctx context.Context, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(sessionID) == "" {
		return errors.New("session id is required")
	}
	return nil
}
