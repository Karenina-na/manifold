package cache

import (
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const overviewCacheKey = "admin-overview"

type OverviewCache struct {
	entries *expirable.LRU[string, model.AdminOverview]
}

func NewOverviewCache(ttl time.Duration) *OverviewCache {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &OverviewCache{entries: expirable.NewLRU[string, model.AdminOverview](1, nil, ttl)}
}

func (c *OverviewCache) Get() (model.AdminOverview, bool) {
	overview, ok := c.entries.Get(overviewCacheKey)
	return overview, ok
}

func (c *OverviewCache) Set(overview model.AdminOverview) {
	c.entries.Add(overviewCacheKey, overview)
}

func (c *OverviewCache) Purge() {
	c.entries.Purge()
}
