package handler_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/handler"
	"github.com/manifold-space/manifold/app/core/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	return handler.Router(cfg, database)
}

func request(t *testing.T, router http.Handler, method, path string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, body)
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestPublicContentAndCommentFlow(t *testing.T) {
	router := newTestRouter(t)

	response := request(t, router, http.MethodGet, "/api/v1/content", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected content 200, got %d", response.Code)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("expected request id header")
	}

	response = request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected content detail 200, got %d", response.Code)
	}

	response = request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note."}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d", response.Code)
	}
}

func TestRequestIDIsPropagatedToStructuredErrors(t *testing.T) {
	router := newTestRouter(t)
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/content/does-not-exist", nil)
	req.Header.Set("X-Request-ID", "req_test_1")
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	if recorder.Header().Get("X-Request-ID") != "req_test_1" {
		t.Fatalf("expected propagated request id, got %q", recorder.Header().Get("X-Request-ID"))
	}
	if !strings.Contains(recorder.Body.String(), `"requestId":"req_test_1"`) {
		t.Fatalf("expected request id in error body, got %s", recorder.Body.String())
	}
}

func TestWriteOperationsCreateAuditEvents(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	router := handler.Router(cfg, database)

	response := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note."}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d", response.Code)
	}
	count, err := database.AuditEventCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one audit event, got %d", count)
	}
}

func TestAdminRequiresBearerToken(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodGet, "/api/v1/admin/content", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestAdminLoginReturnsJWT(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("expected login 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "accessToken") {
		t.Fatalf("expected access token, got %s", response.Body.String())
	}
}
