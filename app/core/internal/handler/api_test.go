package handler_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	router, closeRouter := handler.RouterWithLifecycle(cfg, database)
	t.Cleanup(closeRouter)
	return router
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

func TestContentListIncludesViewAndLikeCounts(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, status) VALUES ('approved-comment', 'content_1', 'Reader', 'Public', 'APPROVED'), ('pending-comment', 'content_1', 'Reader', 'Pending', 'PENDING')`); err != nil {
		t.Fatal(err)
	}
	router := handler.Router(cfg, database)

	first := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d", first.Code)
	}
	metadata := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if metadata.Code != http.StatusOK {
		t.Fatalf("expected metadata detail 200, got %d", metadata.Code)
	}
	liked := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if liked.Code != http.StatusOK {
		t.Fatalf("expected like 200, got %d", liked.Code)
	}
	second := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"viewCount":2`) || !strings.Contains(second.Body.String(), `"likeCount":1`) || !strings.Contains(second.Body.String(), `"commentCount":1`) {
		t.Fatalf("expected cached detail stats to refresh, got %d %s", second.Code, second.Body.String())
	}
	list := request(t, router, http.MethodGet, "/api/v1/content", nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"viewCount":2`) || !strings.Contains(list.Body.String(), `"likeCount":1`) || !strings.Contains(list.Body.String(), `"commentCount":1`) {
		t.Fatalf("expected list stats, got %d %s", list.Code, list.Body.String())
	}
}

func TestApprovingCommentInvalidatesContentCommentCount(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	initial := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"commentCount":0`) {
		t.Fatalf("expected cached detail without comments, got %d %s", initial.Code, initial.Body.String())
	}
	created := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note."}`))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d %s", created.Code, created.Body.String())
	}
	var comment struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &comment); err != nil {
		t.Fatal(err)
	}
	approved := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/"+comment.ID+"/approve", "")
	if approved.Code != http.StatusNoContent {
		t.Fatalf("expected approve 204, got %d %s", approved.Code, approved.Body.String())
	}
	refreshed := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"commentCount":1`) {
		t.Fatalf("expected refreshed approved comment count, got %d %s", refreshed.Code, refreshed.Body.String())
	}
}

func requestWithVisitor(t *testing.T, router http.Handler, method, path, visitorID string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("X-Visitor-ID", visitorID)
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestCommentWithoutAuthorNameUsesAnonymous(t *testing.T) {
	router := newTestRouter(t)

	response := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"body":"A useful note."}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected anonymous comment 201, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"authorName":"Anonymous"`) {
		t.Fatalf("expected normalized anonymous author, got %s", response.Body.String())
	}
}

func TestPresenceCountsRecentVisitors(t *testing.T) {
	router := newTestRouter(t)

	heartbeat := func(visitor string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/presence", nil)
		req.Header.Set("X-Visitor-ID", visitor)
		router.ServeHTTP(recorder, req)
		return recorder
	}

	first := heartbeat("visitor-a")
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"activeVisitors":1`) {
		t.Fatalf("expected one active visitor, got %d %s", first.Code, first.Body.String())
	}
	second := heartbeat("visitor-b")
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"activeVisitors":2`) {
		t.Fatalf("expected two active visitors, got %d %s", second.Code, second.Body.String())
	}
	invalid := heartbeat("short")
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected invalid visitor id 400, got %d %s", invalid.Code, invalid.Body.String())
	}
}

func TestContentLikeFlowIsIdempotentAndVisitorScoped(t *testing.T) {
	router := newTestRouter(t)

	read := func(visitorID string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/content/designing-boundaries/likes", nil)
		req.Header.Set("X-Visitor-ID", visitorID)
		router.ServeHTTP(recorder, req)
		return recorder
	}
	mutate := func(method, visitorID string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/v1/content/designing-boundaries/likes", nil)
		req.Header.Set("X-Visitor-ID", visitorID)
		router.ServeHTTP(recorder, req)
		return recorder
	}

	initial := read("visitor-a")
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"likeCount":0`) {
		t.Fatalf("expected empty like summary, got %d %s", initial.Code, initial.Body.String())
	}
	liked := mutate(http.MethodPut, "visitor-a")
	if liked.Code != http.StatusOK || !strings.Contains(liked.Body.String(), `"likeCount":1`) || !strings.Contains(liked.Body.String(), `"viewerLiked":true`) {
		t.Fatalf("expected visitor like, got %d %s", liked.Code, liked.Body.String())
	}
	repeated := mutate(http.MethodPut, "visitor-a")
	if repeated.Code != http.StatusOK || !strings.Contains(repeated.Body.String(), `"likeCount":1`) {
		t.Fatalf("expected idempotent like, got %d %s", repeated.Code, repeated.Body.String())
	}
	otherVisitor := read("visitor-b")
	if otherVisitor.Code != http.StatusOK || !strings.Contains(otherVisitor.Body.String(), `"viewerLiked":false`) {
		t.Fatalf("expected visitor-scoped state, got %d %s", otherVisitor.Code, otherVisitor.Body.String())
	}
	unliked := mutate(http.MethodDelete, "visitor-a")
	if unliked.Code != http.StatusOK || !strings.Contains(unliked.Body.String(), `"likeCount":0`) || !strings.Contains(unliked.Body.String(), `"viewerLiked":false`) {
		t.Fatalf("expected like removal, got %d %s", unliked.Code, unliked.Body.String())
	}
	missingVisitor := request(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", nil)
	if missingVisitor.Code != http.StatusBadRequest || !strings.Contains(missingVisitor.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected missing visitor id 400, got %d %s", missingVisitor.Code, missingVisitor.Body.String())
	}
	invalidVisitor := mutate(http.MethodPut, "visitor with spaces")
	if invalidVisitor.Code != http.StatusBadRequest || !strings.Contains(invalidVisitor.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected invalid visitor id 400, got %d %s", invalidVisitor.Code, invalidVisitor.Body.String())
	}
	legacy := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries/reactions", nil)
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("expected removed reactions endpoint 404, got %d %s", legacy.Code, legacy.Body.String())
	}
}

func TestRequestIDIsPropagatedToStructuredErrors(t *testing.T) {
	router := newTestRouter(t)
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/content/does-not-exist", nil)
	req.Header.Set("X-Request-ID", "req_test_1")
	req.Header.Set("X-Trace-ID", "trace_test_1")
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	if recorder.Header().Get("X-Request-ID") != "req_test_1" {
		t.Fatalf("expected propagated request id, got %q", recorder.Header().Get("X-Request-ID"))
	}
	if recorder.Header().Get("X-Trace-ID") != "trace_test_1" {
		t.Fatalf("expected propagated trace id, got %q", recorder.Header().Get("X-Trace-ID"))
	}
	if !strings.Contains(recorder.Body.String(), `"requestId":"req_test_1"`) {
		t.Fatalf("expected request id in error body, got %s", recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"traceId":"trace_test_1"`) {
		t.Fatalf("expected trace id in error body, got %s", recorder.Body.String())
	}
}

func TestTraceHeadersAreAllowedByCORS(t *testing.T) {
	router := newTestRouter(t)
	preflight := httptest.NewRecorder()
	preflightRequest := httptest.NewRequest(http.MethodOptions, "/api/v1/content/designing-boundaries/likes", nil)
	preflightRequest.Header.Set("Origin", "http://localhost:3000")
	preflightRequest.Header.Set("Access-Control-Request-Method", http.MethodPut)
	preflightRequest.Header.Set("Access-Control-Request-Headers", "X-Trace-ID, X-Visitor-ID")
	router.ServeHTTP(preflight, preflightRequest)

	if preflight.Code != http.StatusOK {
		t.Fatalf("expected CORS preflight 200, got %d", preflight.Code)
	}
	if !strings.Contains(strings.ToLower(preflight.Header().Get("Access-Control-Allow-Headers")), "x-trace-id") {
		t.Fatalf("expected X-Trace-ID in allowed headers, got %q", preflight.Header().Get("Access-Control-Allow-Headers"))
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	router.ServeHTTP(response, request)
	if !strings.Contains(strings.ToLower(response.Header().Get("Access-Control-Expose-Headers")), "x-trace-id") {
		t.Fatalf("expected X-Trace-ID in exposed headers, got %q", response.Header().Get("Access-Control-Expose-Headers"))
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
	router, closeRouter := handler.RouterWithLifecycle(cfg, database)
	defer closeRouter()

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note."}`))
	req.Header.Set("X-Request-ID", "req_audit_test")
	req.Header.Set("X-Trace-ID", "trace_audit_test")
	router.ServeHTTP(recorder, req)
	response := recorder
	if response.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d", response.Code)
	}
	deadline := time.Now().Add(time.Second)
	for {
		count, err := database.AuditEventCount()
		if err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected one audit event, got %d", count)
		}
		time.Sleep(time.Millisecond)
	}
	var requestID, traceID string
	if err := database.DB.QueryRow(`SELECT request_id, trace_id FROM audit_events LIMIT 1`).Scan(&requestID, &traceID); err != nil {
		t.Fatal(err)
	}
	if requestID != "req_audit_test" || traceID != "trace_audit_test" {
		t.Fatalf("expected audit correlation IDs, got request=%q trace=%q", requestID, traceID)
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

	response := request(t, router, http.MethodGet, "/api/v1/content?kind=THOUGHT&limit=1&q=small", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected filtered content 200, got %d", response.Code)
	}
	var payload struct {
		Data       []struct{ Kind, Slug, Excerpt string } `json:"data"`
		Pagination struct {
			NextCursor string `json:"nextCursor"`
			HasMore    bool   `json:"hasMore"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Kind != "THOUGHT" || payload.Data[0].Slug != "a-small-signal" || payload.Data[0].Excerpt != "Not every observation needs a system. First decide whether it changes the way you work." {
		t.Fatalf("unexpected filtered result: %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"body"`) {
		t.Fatalf("public content response must omit body: %s", response.Body.String())
	}
	feedResponse := request(t, router, http.MethodGet, "/api/v1/feed?kind=THOUGHT&limit=1", nil)
	if feedResponse.Code != http.StatusOK || strings.Contains(feedResponse.Body.String(), `"body"`) {
		t.Fatalf("public feed response must omit body: %d %s", feedResponse.Code, feedResponse.Body.String())
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

	response = request(t, router, http.MethodGet, "/api/v1/content?kind=THOUGHT&kind=ARTICLE&tag=systems", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "designing-boundaries") {
		t.Fatalf("expected repeated kind and tag filters to match, got %d %s", response.Code, response.Body.String())
	}

	for _, invalidQuery := range []string{"kind=INVALID", "cursor=not-a-cursor", "limit=zero", "status=DELETED", "sort=sideways", "aiAssisted=maybe", "page=0", "page=1&cursor=MQ", "skipFirst=true"} {
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

func TestContentPageSortFilterAndTags(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES
		('article_a', 'ARTICLE', 'PUBLISHED', 'article-a', 'Alpha', 'Alpha summary', 'Alpha body', '["go","design"]', '{"aiAssisted":true}', '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z', '2026-06-01T09:00:00Z'),
		('article_b', 'ARTICLE', 'PUBLISHED', 'article-b', 'Bravo', 'Bravo summary', 'Bravo body', '["go"]', '{}', '2026-02-01T09:00:00Z', '2026-02-01T09:00:00Z', '2026-02-01T09:00:00Z'),
		('article_c', 'ARTICLE', 'PUBLISHED', 'article-c', 'Charlie', 'Charlie summary', 'Charlie body', '["sqlite","design"]', '{}', '2026-03-01T09:00:00Z', '2026-03-01T09:00:00Z', '2026-03-01T09:00:00Z'),
		('article_d', 'ARTICLE', 'PUBLISHED', 'article-d', 'Delta', 'Delta summary', 'Delta body', '["go"]', '{}', '2026-04-01T09:00:00Z', '2026-04-01T09:00:00Z', '2026-05-01T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE content SET published_at = '2025-12-01T09:00:00Z', created_at = '2025-12-01T09:00:00Z', updated_at = '2025-12-01T09:00:00Z' WHERE id IN ('content_1', 'content_3')`); err != nil {
		t.Fatal(err)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	router := handler.Router(cfg, database)

	var payload struct {
		Data       []struct{ ID string } `json:"data"`
		Pagination struct {
			NextCursor                             *string
			HasMore                                bool
			Page, PageSize, TotalItems, TotalPages int
		} `json:"pagination"`
	}
	decode := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
	}
	ids := func() []string {
		values := make([]string, 0, len(payload.Data))
		for _, item := range payload.Data {
			values = append(values, item.ID)
		}
		return values
	}

	firstPage := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=1&limit=2", nil)
	decode(firstPage)
	if got := ids(); len(got) != 2 || got[0] != "article_d" || got[1] != "article_c" {
		t.Fatalf("unexpected newest page order: %s", firstPage.Body.String())
	}
	if payload.Pagination.Page != 1 || payload.Pagination.PageSize != 2 || payload.Pagination.TotalItems != 6 || payload.Pagination.TotalPages != 3 || !payload.Pagination.HasMore {
		t.Fatalf("unexpected page pagination: %s", firstPage.Body.String())
	}

	secondPage := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=2&limit=2", nil)
	decode(secondPage)
	if got := ids(); len(got) != 2 || got[0] != "article_b" || got[1] != "article_a" || !payload.Pagination.HasMore {
		t.Fatalf("unexpected second page: %s", secondPage.Body.String())
	}

	clamped := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=99&limit=2", nil)
	decode(clamped)
	clampedIds := ids()
	if payload.Pagination.Page != 3 || len(clampedIds) != 2 || clampedIds[0] != "content_3" {
		t.Fatalf("expected out-of-range page to clamp, got %s", clamped.Body.String())
	}

	oldest := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&sort=oldest&page=1&limit=2", nil)
	decode(oldest)
	if got := ids(); len(got) != 2 || got[0] != "content_1" || got[1] != "content_3" {
		t.Fatalf("unexpected oldest order: %s", oldest.Body.String())
	}

	updated := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&sort=updated&page=1&limit=2", nil)
	decode(updated)
	if got := ids(); len(got) != 2 || got[0] != "article_a" || got[1] != "article_d" {
		t.Fatalf("unexpected updated order: %s", updated.Body.String())
	}

	noAi := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&aiAssisted=false&page=1&limit=10", nil)
	decode(noAi)
	if payload.Pagination.TotalItems != 5 || strings.Contains(noAi.Body.String(), "article_a") {
		t.Fatalf("expected aiAssisted=false to exclude article_a, got %s", noAi.Body.String())
	}

	onlyAi := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&aiAssisted=true&page=1&limit=10", nil)
	decode(onlyAi)
	aiIds := ids()
	if payload.Pagination.TotalItems != 1 || len(aiIds) != 1 || aiIds[0] != "article_a" {
		t.Fatalf("expected aiAssisted=true to match only article_a, got %s", onlyAi.Body.String())
	}

	tagged := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&tag=go&page=1&limit=10", nil)
	decode(tagged)
	if payload.Pagination.TotalItems != 3 || strings.Contains(tagged.Body.String(), "article_c") {
		t.Fatalf("expected tag=go to match three articles, got %s", tagged.Body.String())
	}

	skipFirst := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=1&limit=2&skipFirst=true", nil)
	decode(skipFirst)
	if got := ids(); len(got) != 2 || got[0] != "article_c" || got[1] != "article_b" || payload.Pagination.TotalItems != 6 || payload.Pagination.TotalPages != 3 {
		t.Fatalf("expected skipFirst to drop the newest item, got %s", skipFirst.Body.String())
	}
	skipLast := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=3&limit=2&skipFirst=true", nil)
	decode(skipLast)
	if got := ids(); len(got) != 1 || got[0] != "content_1" || payload.Pagination.HasMore {
		t.Fatalf("expected skipFirst last page, got %s", skipLast.Body.String())
	}

	skipOnly := request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&aiAssisted=true&page=1&limit=10&skipFirst=true", nil)
	decode(skipOnly)
	if !strings.Contains(skipOnly.Body.String(), `"data":[]`) || payload.Pagination.TotalItems != 1 {
		t.Fatalf("expected skipFirst-only-match to return an empty data array, got %s", skipOnly.Body.String())
	}

	thoughtTags := request(t, router, http.MethodGet, "/api/v1/tags?kind=THOUGHT", nil)
	if thoughtTags.Code != http.StatusOK || !strings.Contains(thoughtTags.Body.String(), `{"name":"thinking","count":1}`) {
		t.Fatalf("expected thought tags, got %d %s", thoughtTags.Code, thoughtTags.Body.String())
	}
	allTags := request(t, router, http.MethodGet, "/api/v1/tags", nil)
	if allTags.Code != http.StatusOK || !strings.Contains(allTags.Body.String(), `"name":"go","count":3`) || !strings.Contains(allTags.Body.String(), `"name":"design","count":3`) {
		t.Fatalf("expected aggregated tags, got %d %s", allTags.Code, allTags.Body.String())
	}
	if invalidTags := request(t, router, http.MethodGet, "/api/v1/tags?kind=NOPE", nil); invalidTags.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid tag kind 400, got %d %s", invalidTags.Code, invalidTags.Body.String())
	}
}

func TestThoughtArchiveFilters(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.DB.Exec(`INSERT INTO content (id, kind, status, slug, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES
		('thought_1', 'THOUGHT', 'PUBLISHED', NULL, 'Pinned', 'Pinned summary', 'Pinned body', '["notes"]', '{}', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z'),
		('thought_2', 'THOUGHT', 'PUBLISHED', NULL, 'Work', 'Work summary', 'Work body', '["work"]', '{}', '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z'),
		('thought_3', 'THOUGHT', 'PUBLISHED', NULL, 'Needle', 'Needle summary', 'A needle in the notes.', '["notes","work"]', '{}', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE content SET published_at = '2026-01-01T09:00:00Z', created_at = '2026-01-01T09:00:00Z', updated_at = '2026-01-01T09:00:00Z' WHERE id = 'content_2'`); err != nil {
		t.Fatal(err)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	router := handler.Router(cfg, database)
	token := adminToken(t, router)
	if configured := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/thoughts/config", `{"featuredThoughtId":"thought_1"}`); configured.Code != http.StatusOK {
		t.Fatalf("expected thought config update, got %d %s", configured.Code, configured.Body.String())
	}

	var payload struct {
		Featured   struct{ ID string }            `json:"featured"`
		Data       []struct{ ID, Excerpt string } `json:"data"`
		Pagination struct {
			Page, PageSize, TotalItems, TotalPages int
		} `json:"pagination"`
	}
	decode := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
	}

	tagged := request(t, router, http.MethodGet, "/api/v1/thoughts?tag=notes&page=1&limit=10", nil)
	decode(tagged)
	if payload.Featured.ID != "thought_1" || payload.Pagination.TotalItems != 1 || len(payload.Data) != 1 || payload.Data[0].ID != "thought_3" {
		t.Fatalf("expected tag=notes to keep featured and match only thought_3, got %s", tagged.Body.String())
	}

	searched := request(t, router, http.MethodGet, "/api/v1/thoughts?q=needle&page=1&limit=10", nil)
	decode(searched)
	if payload.Pagination.TotalItems != 1 || len(payload.Data) != 1 || payload.Data[0].ID != "thought_3" {
		t.Fatalf("expected q=needle to match thought_3, got %s", searched.Body.String())
	}

	empty := request(t, router, http.MethodGet, "/api/v1/thoughts?q=zurich&tag=notes&page=3&limit=8", nil)
	decode(empty)
	if payload.Featured.ID != "thought_1" || payload.Pagination.TotalItems != 0 || payload.Pagination.Page != 1 || len(payload.Data) != 0 {
		t.Fatalf("expected empty filter result with featured kept, got %s", empty.Body.String())
	}

	if tooLong := request(t, router, http.MethodGet, "/api/v1/thoughts?q="+strings.Repeat("x", 201), nil); tooLong.Code != http.StatusBadRequest {
		t.Fatalf("expected long q 400, got %d %s", tooLong.Code, tooLong.Body.String())
	}
}

func TestThoughtArchiveIsOwnedByCore(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.DB.Exec(`INSERT INTO content (id, kind, status, title, summary, body, tags_json, metadata_json, published_at, created_at, updated_at) VALUES
		('thought_newest', 'THOUGHT', 'PUBLISHED', 'Newest', 'Newest summary', 'Newest body', '["notes"]', '{}', '2026-08-27T09:00:00Z', '2026-08-27T09:00:00Z', '2026-08-27T09:00:00Z'),
		('thought_middle', 'THOUGHT', 'PUBLISHED', 'Middle', 'Middle summary', 'Middle body', '["notes"]', '{}', '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z'),
		('thought_draft', 'THOUGHT', 'DRAFT', 'Draft', '', 'Draft body', '[]', '{}', NULL, '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE content SET published_at = '2026-06-03T09:00:00Z', created_at = '2026-06-03T09:00:00Z' WHERE id = 'content_2'`); err != nil {
		t.Fatal(err)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	router := handler.Router(cfg, database)
	token := adminToken(t, router)

	fallback := request(t, router, http.MethodGet, "/api/v1/thoughts?page=1&limit=1", nil)
	if fallback.Code != http.StatusOK || !strings.Contains(fallback.Body.String(), `"featured":{"id":"thought_newest"`) {
		t.Fatalf("expected latest published thought fallback, got %d %s", fallback.Code, fallback.Body.String())
	}

	configured := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/thoughts/config", `{"featuredThoughtId":"thought_middle"}`)
	if configured.Code != http.StatusOK || !strings.Contains(configured.Body.String(), `"featuredThoughtId":"thought_middle"`) {
		t.Fatalf("expected thought configuration update, got %d %s", configured.Code, configured.Body.String())
	}

	firstPage := request(t, router, http.MethodGet, "/api/v1/thoughts?page=1&limit=1", nil)
	var payload struct {
		Featured   struct{ ID, Excerpt string }   `json:"featured"`
		Data       []struct{ ID, Excerpt string } `json:"data"`
		Pagination struct {
			Page, PageSize, TotalItems, TotalPages int
		} `json:"pagination"`
	}
	if err := json.Unmarshal(firstPage.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if firstPage.Code != http.StatusOK || payload.Featured.ID != "thought_middle" || payload.Featured.Excerpt != "Middle body" || len(payload.Data) != 1 || payload.Data[0].ID != "thought_newest" || payload.Data[0].Excerpt != "Newest body" {
		t.Fatalf("expected configured thought to be excluded from first archive page, got %d %s", firstPage.Code, firstPage.Body.String())
	}
	if strings.Contains(firstPage.Body.String(), `"body"`) {
		t.Fatalf("public thoughts response must omit body: %s", firstPage.Body.String())
	}
	if payload.Pagination.Page != 1 || payload.Pagination.PageSize != 1 || payload.Pagination.TotalItems != 2 || payload.Pagination.TotalPages != 2 {
		t.Fatalf("unexpected thought pagination: %s", firstPage.Body.String())
	}
	lastPage := request(t, router, http.MethodGet, "/api/v1/thoughts?page=99&limit=1", nil)
	if err := json.Unmarshal(lastPage.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if lastPage.Code != http.StatusOK || payload.Pagination.Page != 2 || len(payload.Data) != 1 || payload.Data[0].ID != "content_2" {
		t.Fatalf("expected out-of-range thought page to clamp to the last page, got %d %s", lastPage.Code, lastPage.Body.String())
	}
	for _, invalidQuery := range []string{"page=0", "page=nope", "limit=0", "limit=51"} {
		response := request(t, router, http.MethodGet, "/api/v1/thoughts?"+invalidQuery, nil)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_QUERY") {
			t.Fatalf("expected invalid thought query %q to be rejected, got %d %s", invalidQuery, response.Code, response.Body.String())
		}
	}

	for _, invalidID := range []string{"content_1", "thought_draft", "missing"} {
		response := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/thoughts/config", fmt.Sprintf(`{"featuredThoughtId":%q}`, invalidID))
		if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), "VALIDATION_ERROR") {
			t.Fatalf("expected invalid featured thought %q to be rejected, got %d %s", invalidID, response.Code, response.Body.String())
		}
	}
	cleared := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/thoughts/config", `{"featuredThoughtId":null}`)
	if cleared.Code != http.StatusOK || !strings.Contains(cleared.Body.String(), `"featuredThoughtId":null`) {
		t.Fatalf("expected explicit thought configuration to clear, got %d %s", cleared.Code, cleared.Body.String())
	}
}

func TestPublishedContentCacheInvalidatesAfterAdminUpdate(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	initial := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"title":"Designing Boundaries"`) {
		t.Fatalf("expected initial public content, got %d %s", initial.Code, initial.Body.String())
	}

	updated := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/content/content_1", `{"title":"Updated Boundaries","expectedVersion":1}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("expected content update 200, got %d %s", updated.Code, updated.Body.String())
	}

	refreshed := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"title":"Updated Boundaries"`) {
		t.Fatalf("expected invalidated public content, got %d %s", refreshed.Code, refreshed.Body.String())
	}

	unpublished := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/unpublish", "")
	if unpublished.Code != http.StatusOK {
		t.Fatalf("expected unpublish 200, got %d %s", unpublished.Code, unpublished.Body.String())
	}
	missing := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected unpublished content 404, got %d %s", missing.Code, missing.Body.String())
	}

	published := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/publish", "")
	if published.Code != http.StatusOK {
		t.Fatalf("expected publish 200, got %d %s", published.Code, published.Body.String())
	}
	republished := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if republished.Code != http.StatusOK || !strings.Contains(republished.Body.String(), `"title":"Updated Boundaries"`) {
		t.Fatalf("expected republished content, got %d %s", republished.Code, republished.Body.String())
	}
}

func TestRouterPrewarmsFeaturedPublishedContent(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	router, closeRouter := handler.RouterWithLifecycle(cfg, database)
	defer closeRouter()

	if _, err := database.DB.Exec(`UPDATE content SET title = 'Database-only title' WHERE id = 'content_1'`); err != nil {
		t.Fatal(err)
	}
	response := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"title":"Designing Boundaries"`) {
		t.Fatalf("expected featured content to be prewarmed, got %d %s", response.Code, response.Body.String())
	}
}

func TestStatsSnapshotInvalidatesAfterPublishingContent(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	initial := request(t, router, http.MethodGet, "/api/v1/stats", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"contentCount":3`) {
		t.Fatalf("expected initial stats, got %d %s", initial.Code, initial.Body.String())
	}

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"stats-snapshot-thought","title":"Snapshot","body":"one two","tags":[]}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected draft creation 201, got %d %s", created.Code, created.Body.String())
	}
	var content struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}

	published := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+content.ID+"/publish", "")
	if published.Code != http.StatusOK {
		t.Fatalf("expected publish 200, got %d %s", published.Code, published.Body.String())
	}

	refreshed := request(t, router, http.MethodGet, "/api/v1/stats", nil)
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"contentCount":4`) {
		t.Fatalf("expected invalidated stats snapshot, got %d %s", refreshed.Code, refreshed.Body.String())
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
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/content", strings.NewReader(`{"kind":"THOUGHT","slug":"versioned-thought","title":"Before","summary":"","body":"Body","tags":[]}`))
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

func TestAdminContentMetadataIsTypedByKind(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)
	cases := []struct{ kind, slug, metadata string }{
		{"ARTICLE", "typed-article", `{"readingMinutes":4}`},
		{"THOUGHT", "typed-thought", `{"mood":"Calm","question":"Why?"}`},
		{"ARTICLE", "typed-article-two", `{"readingMinutes":12}`},
	}
	for _, item := range cases {
		body := fmt.Sprintf(`{"kind":%q,"slug":%q,"title":"Typed","body":"Body","tags":[],"metadata":%s}`, item.kind, item.slug, item.metadata)
		created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", body)
		var payload struct {
			Metadata map[string]any `json:"metadata"`
		}
		_ = json.Unmarshal(created.Body.Bytes(), &payload)
		if created.Code != http.StatusCreated || len(payload.Metadata) == 0 {
			t.Fatalf("expected typed metadata for %s, got %d %s", item.kind, created.Code, created.Body.String())
		}
	}
	invalid := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"invalid-article","title":"Invalid","body":"Body","tags":[],"metadata":{"readingMinutes":-1}}`)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected invalid article metadata 422, got %d %s", invalid.Code, invalid.Body.String())
	}
	for _, item := range []struct {
		kind     string
		metadata string
	}{
		{"THOUGHT", `{"source":42}`},
		{"ARTICLE", `{"technologies":["Go",42]}`},
		{"ARTICLE", `{"toc":[{"id":"section","label":"Section","level":4}]}`},
		{"ARTICLE", `{"frontmatter":{"series":42}}`},
	} {
		invalid = adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", fmt.Sprintf(`{"kind":%q,"slug":"invalid-%d","title":"Invalid","body":"Body","tags":[],"metadata":%s}`, item.kind, time.Now().UnixNano(), item.metadata))
		if invalid.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected invalid metadata 422 for %s, got %d %s", item.metadata, invalid.Code, invalid.Body.String())
		}
	}

	thought := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","title":"Convert me","body":"Body","tags":[],"metadata":{}}`)
	if thought.Code != http.StatusCreated {
		t.Fatalf("expected thought creation 201, got %d %s", thought.Code, thought.Body.String())
	}
	var created struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal(thought.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	converted := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/content/"+created.ID, fmt.Sprintf(`{"kind":"ARTICLE","slug":"converted-thought","title":"Converted","expectedVersion":%d}`, created.Version))
	if converted.Code != http.StatusOK || !strings.Contains(converted.Body.String(), `"kind":"ARTICLE"`) {
		t.Fatalf("expected thought to article conversion, got %d %s", converted.Code, converted.Body.String())
	}
}

func TestAdminConfigurationManagement(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	profile := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/profile", `{"displayName":"Updated Garden","handle":"@updated","series":[{"name":"Relay","url":"https://relay.example","description":"A public relay","category":"Infrastructure"}],"contacts":[{"label":"WhatsApp","url":"https://wa.me/123","handle":"+123"}]}`)
	if profile.Code != http.StatusOK || !strings.Contains(profile.Body.String(), "Updated Garden") || !strings.Contains(profile.Body.String(), "Relay") || !strings.Contains(profile.Body.String(), "WhatsApp") {
		t.Fatalf("expected profile update 200, got %d %s", profile.Code, profile.Body.String())
	}

	site := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/site", `{"navigation":[{"label":"Notes","href":"/writing"}],"sections":["PROFILE","FEED"]}`)
	if site.Code != http.StatusOK || !strings.Contains(site.Body.String(), "Notes") {
		t.Fatalf("expected site update 200, got %d %s", site.Code, site.Body.String())
	}
	publicSite := request(t, router, http.MethodGet, "/api/v1/site", nil)
	if publicSite.Code != http.StatusOK || !strings.Contains(publicSite.Body.String(), "Notes") {
		t.Fatalf("expected public site to use persisted config, got %d %s", publicSite.Code, publicSite.Body.String())
	}

}

func adminToken(t *testing.T, router http.Handler) string {
	t.Helper()
	login := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
	var session struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil || session.AccessToken == "" {
		t.Fatalf("expected admin token, got %d %s", login.Code, login.Body.String())
	}
	return session.AccessToken
}

func adminRequest(t *testing.T, router http.Handler, token string, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(recorder, req)
	return recorder
}
