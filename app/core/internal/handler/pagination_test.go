package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The chain list endpoints used to answer an empty result with totalPages 0
// while media and audit answered 1, and they never pulled a page past the end
// back — one envelope with two boundary behaviours. Every collection producer
// now goes through the same clamp, so an empty set is page 1 of 1 and an
// out-of-range page is clamped to the last one.
func TestEmptyCollectionReportsPageOneOfOne(t *testing.T) {
	router, _ := newTestRouterWithChain(t, nil)

	for _, path := range []string{
		"/api/v1/chain/anchors?source=comment",
		"/api/v1/chain/anchors?source=comment&page=7",
		"/api/v1/chain/anchors?source=comment&pageSize=50&page=3",
	} {
		response := request(t, router, http.MethodGet, path, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d %s", path, response.Code, response.Body.String())
		}
		var payload struct {
			Data       []any `json:"data"`
			Pagination struct {
				Page       int `json:"page"`
				PageSize   int `json:"pageSize"`
				TotalItems int `json:"totalItems"`
				TotalPages int `json:"totalPages"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Data) != 0 || payload.Pagination.TotalItems != 0 {
			t.Fatalf("%s: expected an empty anchor list, got %s", path, response.Body.String())
		}
		if payload.Pagination.Page != 1 || payload.Pagination.TotalPages != 1 {
			t.Fatalf("%s: an empty collection must report page 1 of 1, got %s", path, response.Body.String())
		}
	}
}
