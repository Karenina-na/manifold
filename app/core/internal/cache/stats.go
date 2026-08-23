package cache

import (
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const statsCacheKey = "published-content-stats"

type StatsCache struct {
	entries *expirable.LRU[string, model.Stats]
}

func NewStatsCache(ttl time.Duration) *StatsCache {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &StatsCache{entries: expirable.NewLRU[string, model.Stats](1, nil, ttl)}
}

func (c *StatsCache) Get() (model.Stats, bool) {
	stats, ok := c.entries.Get(statsCacheKey)
	return stats, ok
}

func (c *StatsCache) Set(stats model.Stats) {
	c.entries.Add(statsCacheKey, stats)
}

func (c *StatsCache) Purge() {
	c.entries.Purge()
}
