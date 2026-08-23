package cache

import (
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestStatsCacheStoresAndPurgesSnapshots(t *testing.T) {
	cache := NewStatsCache(time.Minute)
	stats := model.Stats{ContentCount: 3, WordCount: 42}

	cache.Set(stats)
	cached, ok := cache.Get()
	if !ok || cached.ContentCount != 3 || cached.WordCount != 42 {
		t.Fatalf("expected cached stats, got %+v, %v", cached, ok)
	}

	cache.Purge()
	if _, ok := cache.Get(); ok {
		t.Fatal("expected purged stats to be unavailable")
	}
}
