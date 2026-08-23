package handler_test

import (
	"encoding/json"
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

func TestContentReactionFlowIsIdempotentAndVisitorScoped(t *testing.T) {
	router := newTestRouter(t)

	read := func(visitorID string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/content/designing-boundaries/reactions", nil)
		req.Header.Set("X-Visitor-ID", visitorID)
		router.ServeHTTP(recorder, req)
		return recorder
	}
	mutate := func(method, kind, visitorID string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/v1/content/designing-boundaries/reactions/"+kind, nil)
		req.Header.Set("X-Visitor-ID", visitorID)
		router.ServeHTTP(recorder, req)
		return recorder
	}

	initial := read("visitor-a")
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"likeCount":0`) {
		t.Fatalf("expected empty reaction summary, got %d %s", initial.Code, initial.Body.String())
	}
	liked := mutate(http.MethodPut, "LIKE", "visitor-a")
	if liked.Code != http.StatusOK || !strings.Contains(liked.Body.String(), `"likeCount":1`) || !strings.Contains(liked.Body.String(), `"viewerLiked":true`) {
		t.Fatalf("expected visitor like, got %d %s", liked.Code, liked.Body.String())
	}
	repeated := mutate(http.MethodPut, "LIKE", "visitor-a")
	if repeated.Code != http.StatusOK || !strings.Contains(repeated.Body.String(), `"likeCount":1`) {
		t.Fatalf("expected idempotent like, got %d %s", repeated.Code, repeated.Body.String())
	}
	otherVisitor := read("visitor-b")
	if otherVisitor.Code != http.StatusOK || !strings.Contains(otherVisitor.Body.String(), `"viewerLiked":false`) {
		t.Fatalf("expected visitor-scoped state, got %d %s", otherVisitor.Code, otherVisitor.Body.String())
	}
	bookmarked := mutate(http.MethodPut, "FAVORITE", "visitor-a")
	if bookmarked.Code != http.StatusOK || !strings.Contains(bookmarked.Body.String(), `"viewerFavorited":true`) {
		t.Fatalf("expected visitor bookmark, got %d %s", bookmarked.Code, bookmarked.Body.String())
	}
	unliked := mutate(http.MethodDelete, "LIKE", "visitor-a")
	if unliked.Code != http.StatusOK || !strings.Contains(unliked.Body.String(), `"likeCount":0`) || !strings.Contains(unliked.Body.String(), `"viewerLiked":false`) {
		t.Fatalf("expected like removal, got %d %s", unliked.Code, unliked.Body.String())
	}
	invalid := mutate(http.MethodPut, "CLAP", "visitor-a")
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "REACTION_KIND_INVALID") {
		t.Fatalf("expected invalid reaction kind 400, got %d %s", invalid.Code, invalid.Body.String())
	}
	missingVisitor := request(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/reactions/LIKE", nil)
	if missingVisitor.Code != http.StatusBadRequest || !strings.Contains(missingVisitor.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected missing visitor id 400, got %d %s", missingVisitor.Code, missingVisitor.Body.String())
	}
	invalidVisitor := mutate(http.MethodPut, "LIKE", "visitor with spaces")
	if invalidVisitor.Code != http.StatusBadRequest || !strings.Contains(invalidVisitor.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected invalid visitor id 400, got %d %s", invalidVisitor.Code, invalidVisitor.Body.String())
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
	preflightRequest := httptest.NewRequest(http.MethodOptions, "/api/v1/content/designing-boundaries/reactions/LIKE", nil)
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

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"NOTE","slug":"stats-snapshot-note","title":"Snapshot","body":"one two","tags":[]}`)
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

func TestAdminConfigurationAndProjectManagement(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	profile := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/profile", `{"displayName":"Updated Garden","handle":"@updated"}`)
	if profile.Code != http.StatusOK || !strings.Contains(profile.Body.String(), "Updated Garden") {
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

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/projects", `{"slug":"new-project","name":"New Project","status":"ACTIVE","techStack":["Go"]}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected project create 201, got %d %s", created.Code, created.Body.String())
	}
	var project struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &project); err != nil || project.ID == "" {
		t.Fatalf("expected project id, got %s", created.Body.String())
	}
	updated := adminRequest(t, router, token, http.MethodPatch, "/api/v1/admin/projects/"+project.ID, `{"name":"Renamed Project"}`)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), "Renamed Project") {
		t.Fatalf("expected project update 200, got %d %s", updated.Code, updated.Body.String())
	}
	deleted := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/projects/"+project.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected project delete 204, got %d %s", deleted.Code, deleted.Body.String())
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
