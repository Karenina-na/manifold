package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/manifold-space/manifold/apps/core/internal/handler"
)

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	handler.Health(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if got := recorder.Body.String(); got != "{\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected response: %s", got)
	}
}

