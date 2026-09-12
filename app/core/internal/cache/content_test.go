package cache

import (
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestContentCacheExpiresAndInvalidatesEntries(t *testing.T) {
	title := "First"
	content := model.Content{ID: "content_1", Slug: "first", Title: &title, Tags: []string{"systems"}}
	// The wait is expressed as a multiple of the TTL rather than as two
	// independent constants: time.Sleep only guarantees a lower bound, so the
	// assertion holds as long as the wait exceeds the TTL, and deriving it keeps
	// that relationship true if the TTL is ever changed.
	const ttl = 10 * time.Millisecond
	cache := NewContentCache(ttl)

	cache.Set(content.Slug, content)
	cached, ok := cache.Get(content.Slug)
	if !ok || cached.Title == nil || *cached.Title != title {
		t.Fatalf("expected cached content, got %+v, %v", cached, ok)
	}

	time.Sleep(2 * ttl)
	if _, ok := cache.Get(content.Slug); ok {
		t.Fatal("expected expired content to be unavailable")
	}

	cache.Set(content.Slug, content)
	cache.Remove(content.Slug)
	if _, ok := cache.Get(content.Slug); ok {
		t.Fatal("expected deleted content to be unavailable")
	}
}
