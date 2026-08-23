package cache

import (
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

const maxContentEntries = 256

type ContentCache struct {
	entries *expirable.LRU[string, model.Content]
}

func NewContentCache(ttl time.Duration) *ContentCache {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &ContentCache{entries: expirable.NewLRU[string, model.Content](maxContentEntries, nil, ttl)}
}

func (c *ContentCache) Get(slug string) (model.Content, bool) {
	content, ok := c.entries.Get(slug)
	if !ok {
		return model.Content{}, false
	}
	return cloneContent(content), true
}

func (c *ContentCache) Set(slug string, content model.Content) {
	c.entries.Add(slug, cloneContent(content))
}

func (c *ContentCache) Remove(slug string) {
	if slug != "" {
		c.entries.Remove(slug)
	}
}

func (c *ContentCache) Purge() {
	c.entries.Purge()
}

func cloneContent(content model.Content) model.Content {
	content.Tags = append([]string(nil), content.Tags...)
	if content.PublishedAt != nil {
		publishedAt := *content.PublishedAt
		content.PublishedAt = &publishedAt
	}
	return content
}
