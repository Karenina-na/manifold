package handler_test

import (
	"encoding/json"
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

func TestContentQueryFiltersAndPaginates(t *testing.T) {
	router := newTestRouter(t)

	response := request(t, router, http.MethodGet, "/api/v1/content?kind=NOTE&limit=1&q=small", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected filtered content 200, got %d", response.Code)
	}
	var payload struct {
		Data       []struct{ Kind, Slug string } `json:"data"`
		Pagination struct {
			NextCursor string `json:"nextCursor"`
			HasMore    bool   `json:"hasMore"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Kind != "NOTE" || payload.Data[0].Slug != "a-small-signal" {
		t.Fatalf("unexpected filtered result: %s", response.Body.String())
	}
	if payload.Pagination.HasMore || payload.Pagination.NextCursor != "" {
		t.Fatalf("expected a single filtered page, got %s", response.Body.String())
	}

	response = request(t, router, http.MethodGet, "/api/v1/content?limit=1", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected paginated content 200, got %d", response.Code)
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || !payload.Pagination.HasMore || payload.Pagination.NextCursor == "" {
		t.Fatalf("expected next cursor for multi-page result, got %s", response.Body.String())
	}
	firstCursor := payload.Pagination.NextCursor
	response = request(t, router, http.MethodGet, "/api/v1/content?limit=1&cursor="+firstCursor, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected second page 200, got %d", response.Code)
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Slug == "designing-boundaries" {
		t.Fatalf("expected the second content page, got %s", response.Body.String())
	}

	response = request(t, router, http.MethodGet, "/api/v1/content?kind=NOTE&kind=POST&tag=systems", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "designing-boundaries") {
		t.Fatalf("expected repeated kind and tag filters to match, got %d %s", response.Code, response.Body.String())
	}

	for _, invalidQuery := range []string{"kind=INVALID", "cursor=not-a-cursor", "limit=zero", "status=DELETED"} {
		response = request(t, router, http.MethodGet, "/api/v1/content?"+invalidQuery, nil)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_QUERY") {
			t.Fatalf("expected invalid query 400 for %q, got %d %s", invalidQuery, response.Code, response.Body.String())
		}
	}

	response = request(t, router, http.MethodGet, "/api/v1/content?limit=0", nil)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_QUERY") {
		t.Fatalf("expected invalid query 400, got %d %s", response.Code, response.Body.String())
	}
}

func TestAdminContentPatchUsesExpectedVersion(t *testing.T) {
	router := newTestRouter(t)
	login := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
	var session struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	create := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/content", strings.NewReader(`{"kind":"NOTE","slug":"versioned-note","title":"Before","summary":"","body":"Body","tags":[]}`))
	createRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	router.ServeHTTP(create, createRequest)
	if create.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d %s", create.Code, create.Body.String())
	}
	var content struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}

	patch := func(expectedVersion int, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/content/"+content.ID, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+session.AccessToken)
		router.ServeHTTP(recorder, req)
		return recorder
	}
	response := patch(content.Version, `{"title":"After","expectedVersion":1}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "After") {
		t.Fatalf("expected partial update 200, got %d %s", response.Code, response.Body.String())
	}
	response = patch(content.Version, `{"title":"Stale","expectedVersion":1}`)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "VERSION_CONFLICT") {
		t.Fatalf("expected version conflict 409, got %d %s", response.Code, response.Body.String())
	}
	response = patch(2, `{}`)
	if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("expected empty patch 422, got %d %s", response.Code, response.Body.String())
	}

	deletedRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/content/"+content.ID, nil)
	deletedRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	deleted := httptest.NewRecorder()
	router.ServeHTTP(deleted, deletedRequest)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d %s", deleted.Code, deleted.Body.String())
	}
	adminList := httptest.NewRecorder()
	adminListRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/content?status=DELETED", nil)
	adminListRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	router.ServeHTTP(adminList, adminListRequest)
	if adminList.Code != http.StatusOK || !strings.Contains(adminList.Body.String(), content.ID) {
		t.Fatalf("expected deleted content in explicit admin filter, got %d %s", adminList.Code, adminList.Body.String())
	}
	adminList = httptest.NewRecorder()
	adminListRequest = httptest.NewRequest(http.MethodGet, "/api/v1/admin/content", nil)
	adminListRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	router.ServeHTTP(adminList, adminListRequest)
	if adminList.Code != http.StatusOK || strings.Contains(adminList.Body.String(), content.ID) {
		t.Fatalf("expected deleted content to stay out of the default admin list, got %d %s", adminList.Code, adminList.Body.String())
	}
}
