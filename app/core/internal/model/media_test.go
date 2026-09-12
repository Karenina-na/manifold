package model

import (
	"encoding/json"
	"testing"
)

// Media.url is required by packages/contracts even before the HTTP handler has
// enough request context to fill it. Keeping the key in the zero-value JSON
// catches any code path that accidentally serializes a store projection before
// assigning the absolute URL; omitempty used to hide that contract violation.
func TestMediaJSONAlwaysCarriesURL(t *testing.T) {
	encoded, err := json.Marshal(Media{ID: "media_1", Mime: "image/png", Size: 1, Filename: "one.png", CreatedAt: "2026-09-12T00:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	url, exists := body["url"]
	if !exists {
		t.Fatalf("Media JSON omitted the required url key: %s", encoded)
	}
	if url != "" {
		t.Fatalf("zero-value Media url = %#v, want empty string", url)
	}
}
