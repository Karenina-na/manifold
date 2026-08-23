package cache

import (
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestContentCacheExpiresAndInvalidatesEntries(t *testing.T) {
	content := model.Content{ID: "content_1", Slug: "first", Title: "First", Tags: []string{"systems"}}
	cache := NewContentCache(10 * time.Millisecond)

	cache.Set(content.Slug, content)
	cached, ok := cache.Get(content.Slug)
	if !ok || cached.Title != "First" {
		t.Fatalf("expected cached content, got %+v, %v", cached, ok)
	}

	time.Sleep(20 * time.Millisecond)
	if _, ok := cache.Get(content.Slug); ok {
		t.Fatal("expected expired content to be unavailable")
	}

	cache.Set(content.Slug, content)
	cache.Remove(content.Slug)
	if _, ok := cache.Get(content.Slug); ok {
		t.Fatal("expected deleted content to be unavailable")
	}
}
