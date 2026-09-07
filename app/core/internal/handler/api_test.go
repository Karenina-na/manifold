package handler_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/handler"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	database, err := store.Open(":memory:", store.WithAdminCredential("admin", string(hash)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}, AuditEventBuffer: 256}
	router, closeRouter := handler.RouterWithLifecycle(cfg, database, nil)
	t.Cleanup(closeRouter)
	return router
}

func newTestRouterWithConfig(t *testing.T, mutate func(*config.Config)) (http.Handler, *store.Store) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	database, err := store.Open(":memory:", store.WithAdminCredential("admin", string(hash)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}, AuditEventBuffer: 256}
	mutate(&cfg)
	router, closeRouter := handler.RouterWithLifecycle(cfg, database, nil)
	t.Cleanup(closeRouter)
	return router, database
}

// newTestRouterWithChain wires a real ledger over the same test database with
// instant-mining settings (SimDelay 0, FlushTimeout 0) so every submission
// mines within the same MineOnce pass the miner loop runs each tick.
func newTestRouterWithChain(t *testing.T, mutate func(*config.Config)) (http.Handler, *store.Store) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	database, err := store.Open(":memory:", store.WithAdminCredential("admin", string(hash)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}, AuditEventBuffer: 256,
		ChainProofMode: "sim", ChainSimDelay: time.Millisecond, ChainBatchSize: 1, ChainFlushTimeout: time.Millisecond, ChainMaxBlockAnchors: 500, ChainAnchorMaxBytes: 1 << 16}
	if mutate != nil {
		mutate(&cfg)
	}
	ledger := chain.NewLedger(database.DB, chain.LedgerConfig{
		ProofMode: chain.ProofModeSim, Difficulty: 0, SimDelay: time.Millisecond,
		BatchSize: 1, MaxBlockAnchors: 500, FlushTimeout: time.Millisecond, AnchorMaxBytes: 1 << 16,
	})
	if _, err := ledger.EnsureSiteKey(); err != nil {
		t.Fatal(err)
	}
	router, closeRouter := handler.RouterWithLifecycle(cfg, database, ledger)
	t.Cleanup(closeRouter)
	return router, database
}

func request(t *testing.T, router http.Handler, method, path string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, body)
	router.ServeHTTP(recorder, req)
	return recorder
}

func requestWithVisitor(t *testing.T, router http.Handler, method, path, visitorID string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("X-Visitor-ID", visitorID)
	router.ServeHTTP(recorder, req)
	return recorder
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

// decodeSessionID extracts the JWT jti (the admin_sessions row id) from a
// token so a test can target that session by id.
func decodeSessionID(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected a JWT, got %q", token)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		ID string `json:"jti"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	if claims.ID == "" {
		t.Fatal("token carries no jti")
	}
	return claims.ID
}

func adminRequest(t *testing.T, router http.Handler, token string, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
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
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("expected security header on responses")
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

func TestRemovedEndpointsStayRemoved(t *testing.T) {
	router := newTestRouter(t)
	for _, path := range []string{"/api/v1/feed", "/api/v1/thoughts", "/api/v1/writings", "/api/v1/content/designing-boundaries/reactions", "/api/v1/now"} {
		if response := request(t, router, http.MethodGet, path, nil); response.Code != http.StatusNotFound {
			t.Fatalf("expected removed endpoint %s to 404, got %d", path, response.Code)
		}
	}
}

func TestPublicListContract(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodGet, "/api/v1/content?kind=THOUGHT&pageSize=1&q=signal", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected content 200, got %d", response.Code)
	}
	var payload struct {
		Data []struct {
			Kind     string `json:"kind"`
			Slug     string `json:"slug"`
			Excerpt  string `json:"excerpt"`
			Metadata struct {
				Mood *string `json:"mood"`
			} `json:"metadata"`
		} `json:"data"`
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
	if len(payload.Data) != 1 || payload.Data[0].Kind != "THOUGHT" || payload.Data[0].Slug != "a-small-signal" {
		t.Fatalf("unexpected filtered result: %s", response.Body.String())
	}
	if payload.Data[0].Excerpt == "" || payload.Data[0].Metadata.Mood == nil || *payload.Data[0].Metadata.Mood != "Curious" {
		t.Fatalf("expected persisted excerpt and typed metadata: %s", response.Body.String())
	}
	if payload.Pagination.Page != 1 || payload.Pagination.PageSize != 1 || payload.Pagination.TotalItems != 1 || payload.Pagination.TotalPages != 1 {
		t.Fatalf("expected page pagination on public list: %s", response.Body.String())
	}
	for _, forbidden := range []string{`"body"`, `"status"`, `"version"`, `"href"`, `"nextCursor"`} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("public list must not expose %s: %s", forbidden, response.Body.String())
		}
	}
	// The public shape emits null keys instead of omitting them; the seeded
	// thought carries a title but leaves context/source unset.
	if !strings.Contains(response.Body.String(), `"context":null`) || !strings.Contains(response.Body.String(), `"source":null`) {
		t.Fatalf("expected null metadata keys on thought, got %s", response.Body.String())
	}
}

func TestContentDetailContract(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d", response.Code)
	}
	var detail struct {
		Body        string `json:"body"`
		PublishedAt string `json:"publishedAt"`
		Metadata    struct {
			ReadingMinutes int `json:"readingMinutes"`
			Toc            []struct {
				ID    string `json:"id"`
				Level int    `json:"level"`
			} `json:"toc"`
			Language string `json:"language"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Body == "" || detail.PublishedAt == "" || detail.Metadata.ReadingMinutes == 0 || len(detail.Metadata.Toc) != 1 || detail.Metadata.Language != "English" {
		t.Fatalf("unexpected detail contract: %s", response.Body.String())
	}
}

func TestContentListPageSortFilterAndTags(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {})
	token := adminToken(t, router)
	seedRows(t, router, token, database)

	var payload struct {
		Data       []struct{ Slug string } `json:"data"`
		Pagination struct {
			Page, PageSize, TotalItems, TotalPages int
		} `json:"pagination"`
	}
	decode := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
		}
		payload.Data = nil
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
	}
	slugs := func() []string {
		values := make([]string, 0, len(payload.Data))
		for _, item := range payload.Data {
			values = append(values, item.Slug)
		}
		return values
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=1&pageSize=2", nil))
	if got := slugs(); len(got) != 2 || got[0] != "article-d" || got[1] != "article-c" {
		t.Fatalf("unexpected newest page order: %v", got)
	}
	if payload.Pagination.Page != 1 || payload.Pagination.PageSize != 2 || payload.Pagination.TotalItems != 15 || payload.Pagination.TotalPages != 8 {
		t.Fatalf("unexpected page pagination: %+v", payload.Pagination)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&sort=oldest&page=1&pageSize=2", nil))
	if got := slugs(); len(got) != 2 || got[0] != "designing-boundaries" {
		t.Fatalf("unexpected oldest order: %v", got)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&sort=updated&page=1&pageSize=2", nil))
	if got := slugs(); len(got) != 2 || got[0] != "article-a" {
		t.Fatalf("unexpected updated order: %v", got)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&aiAssisted=false&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 14 || strings.Contains(strings.Join(slugs(), ","), "article-a") {
		t.Fatalf("expected aiAssisted=false to exclude article-a, got %s", responseOf(t, router, "/api/v1/content?kind=ARTICLE&aiAssisted=false&page=1&pageSize=10"))
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&aiAssisted=true&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 1 || len(slugs()) != 1 || slugs()[0] != "article-a" {
		t.Fatalf("expected aiAssisted=true to match only article-a, got %v", slugs())
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&tag=go&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 8 || strings.Contains(strings.Join(slugs(), ","), "article-c") {
		t.Fatalf("expected tag=go to match eight articles, got %v", slugs())
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&tag=go,design&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 12 {
		t.Fatalf("expected tag=go,design to match twelve articles, got %d", payload.Pagination.TotalItems)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&tag=go&tag=sqlite&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 9 {
		t.Fatalf("expected repeated tag params to match nine articles, got %d", payload.Pagination.TotalItems)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&tag=go,go&page=1&pageSize=10", nil))
	if payload.Pagination.TotalItems != 8 {
		t.Fatalf("expected duplicate tags to dedupe, got %d", payload.Pagination.TotalItems)
	}

	decode(request(t, router, http.MethodGet, "/api/v1/content?kind=ARTICLE&page=99&pageSize=2", nil))
	if payload.Pagination.Page != 8 || len(slugs()) != 1 {
		t.Fatalf("expected out-of-range page to clamp, got page %d", payload.Pagination.Page)
	}

	for _, invalidQuery := range []string{"kind=INVALID", "limit=1", "cursor=MQ", "sort=sideways", "aiAssisted=maybe", "page=0", "page=nope", "pageSize=0", "status=DELETED", "skipFirst=true"} {
		response := request(t, router, http.MethodGet, "/api/v1/content?"+invalidQuery, nil)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_QUERY") {
			t.Fatalf("expected invalid query 400 for %q, got %d %s", invalidQuery, response.Code, response.Body.String())
		}
	}

	tags := request(t, router, http.MethodGet, "/api/v1/tags?kind=THOUGHT", nil)
	if tags.Code != http.StatusOK || !strings.Contains(tags.Body.String(), `{"name":"thinking","count":1}`) {
		t.Fatalf("expected thought tags, got %d %s", tags.Code, tags.Body.String())
	}
	allTags := request(t, router, http.MethodGet, "/api/v1/tags", nil)
	if allTags.Code != http.StatusOK || !strings.Contains(allTags.Body.String(), `"name":"go","count":8`) || !strings.Contains(allTags.Body.String(), `"name":"design","count":9`) {
		t.Fatalf("expected aggregated tags, got %d %s", allTags.Code, allTags.Body.String())
	}
	if invalidTags := request(t, router, http.MethodGet, "/api/v1/tags?kind=NOPE", nil); invalidTags.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid tag kind 400, got %d", invalidTags.Code)
	}
}

func seedRows(t *testing.T, router http.Handler, token string, database *store.Store) {
	t.Helper()
	rows := []string{
		`{"kind":"ARTICLE","slug":"article-a","title":"Alpha","summary":"Alpha summary","body":"Alpha body","tags":["go","design"],"metadata":{"language":"Go","aiAssisted":true}}`,
		`{"kind":"ARTICLE","slug":"article-b","title":"Bravo","summary":"Bravo summary","body":"Bravo body","tags":["go"],"metadata":{"language":null,"aiAssisted":false}}`,
		`{"kind":"ARTICLE","slug":"article-c","title":"Charlie","summary":"Charlie summary","body":"Charlie body","tags":["sqlite","design"],"metadata":{"language":null,"aiAssisted":false}}`,
		`{"kind":"ARTICLE","slug":"article-d","title":"Delta","summary":"Delta summary","body":"Delta body","tags":["go"],"metadata":{"language":null,"aiAssisted":false}}`,
	}
	created := map[string]string{}
	for i, row := range rows {
		response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", row)
		if response.Code != http.StatusCreated {
			t.Fatalf("expected seed create 201, got %d %s", response.Code, response.Body.String())
		}
		var item struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		created[fmt.Sprintf("article-%c", rune('a'+i))] = item.ID
	}
	// Publish and backdate through the store surface so ordering tests are deterministic.
	for slug, id := range created {
		month := map[string]int{"article-a": 1, "article-b": 2, "article-c": 3, "article-d": 4}[slug]
		stamp := fmt.Sprintf("2026-0%d-01T09:00:00Z", month)
		if _, err := database.DB.Exec(`UPDATE content SET status = 'PUBLISHED', published_at = ?, created_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, stamp, id); err != nil {
			t.Fatal(err)
		}
	}
	// Backdate the four oldest seeded articles so seeded + test rows share one
	// deterministic ordering window. The dev set spans 2024-10 through 2025-10
	// except these four, which are pinned before the test rows in 2026.
	stamps := map[string]string{
		"designing-boundaries":     "2025-01-02T09:00:00Z",
		"github-flavored-markdown": "2025-02-05T09:00:00Z",
		"reading-the-edge":         "2025-11-20T09:00:00Z",
		"a-small-signal":           "2025-03-01T09:00:00Z",
	}
	for slug, stamp := range stamps {
		if _, err := database.DB.Exec(`UPDATE content SET published_at = ?, created_at = ?, updated_at = ? WHERE slug = ?`, stamp, stamp, stamp, slug); err != nil {
			t.Fatal(err)
		}
	}
	// Every row's updated_at is aligned to its published_at so the "updated"
	// sort is deterministic regardless of when the database was seeded.
	if _, err := database.DB.Exec(`UPDATE content SET updated_at = COALESCE(published_at, created_at)`); err != nil {
		t.Fatal(err)
	}
	// article-a is the most recently updated row.
	if _, err := database.DB.Exec(`UPDATE content SET updated_at = '2026-06-01T09:00:00Z' WHERE slug = 'article-a'`); err != nil {
		t.Fatal(err)
	}
}

func responseOf(t *testing.T, router http.Handler, path string) string {
	t.Helper()
	return request(t, router, http.MethodGet, path, nil).Body.String()
}

func TestCommentLifecyclePublishesAndSoftDeletes(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	created := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note.","avatarSeed":"seed-123"}`))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d %s", created.Code, created.Body.String())
	}
	var comment struct {
		ID         string  `json:"id"`
		AvatarSeed string  `json:"avatarSeed"`
		DeletedAt  *string `json:"deletedAt"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &comment); err != nil {
		t.Fatal(err)
	}
	if comment.AvatarSeed != "seed-123" || comment.DeletedAt != nil {
		t.Fatalf("expected public comment without deletedAt, got %+v", comment)
	}
	detail := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"commentCount":1`) {
		t.Fatalf("expected created comment to count immediately, got %d %s", detail.Code, detail.Body.String())
	}
	reply := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(fmt.Sprintf(`{"authorName":"Other","body":"A reply.","replyToId":%q}`, comment.ID)))
	if reply.Code != http.StatusCreated {
		t.Fatalf("expected reply 201, got %d %s", reply.Code, reply.Body.String())
	}
	invalidReply := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Other","body":"A reply.","replyToId":"missing-comment"}`))
	if invalidReply.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected invalid reply 422, got %d %s", invalidReply.Code, invalidReply.Body.String())
	}
	deleted := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/comments/"+comment.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d %s", deleted.Code, deleted.Body.String())
	}
	hidden := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if hidden.Code != http.StatusOK || !strings.Contains(hidden.Body.String(), `"commentCount":0`) {
		t.Fatalf("expected deleted comment to drop from count, got %d %s", hidden.Code, hidden.Body.String())
	}
	adminList := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments", "")
	if adminList.Code != http.StatusOK || !strings.Contains(adminList.Body.String(), `"deletedAt":"20`) {
		t.Fatalf("expected admin list to expose deleted comments, got %d %s", adminList.Code, adminList.Body.String())
	}
	restored := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/"+comment.ID+"/restore", "")
	if restored.Code != http.StatusNoContent {
		t.Fatalf("expected restore 204, got %d %s", restored.Code, restored.Body.String())
	}
	refreshed := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"commentCount":2`) {
		t.Fatalf("expected restored comment to count again, got %d %s", refreshed.Code, refreshed.Body.String())
	}
}

func TestPublicCommentsPaginationAndSearch(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {})
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, created_at) VALUES
		('root-1', 'content_1', 'Ada', 'First root', '2026-01-01T00:00:00Z'),
		('root-2', 'content_1', 'Grace', 'Second root', '2026-01-02T00:00:00Z'),
		('root-3', 'content_1', 'Linus', 'Third root', '2026-01-03T00:00:00Z'),
		('reply-1', 'content_1', 'Ada', 'a needle reply', '2026-01-04T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE comments SET reply_to_id = 'root-1' WHERE id = 'reply-1'; UPDATE content SET comment_count = 4 WHERE id = 'content_1'`); err != nil {
		t.Fatal(err)
	}

	var page struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			TotalItems int `json:"totalItems"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
	}
	load := func(query string) {
		t.Helper()
		response := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries/comments"+query, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("expected comments 200 for %s, got %d %s", query, response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
	}
	ids := func() string {
		values := make([]string, 0, len(page.Data))
		for _, item := range page.Data {
			values = append(values, item.ID)
		}
		return strings.Join(values, ",")
	}

	load("?pageSize=2&page=1")
	if got, want := ids(), "root-1,root-2,reply-1"; got != want {
		t.Fatalf("expected first page of roots with replies attached, got %s", got)
	}
	if page.Pagination.Page != 1 || page.Pagination.PageSize != 2 || page.Pagination.TotalItems != 4 || page.Pagination.TotalPages != 2 {
		t.Fatalf("unexpected pagination meta: %+v", page.Pagination)
	}
	load("?pageSize=2&page=2")
	if got, want := ids(), "root-3"; got != want {
		t.Fatalf("expected second page to hold the last root, got %s", got)
	}
	load("?pageSize=2&q=needle")
	if got, want := ids(), "root-1,reply-1"; got != want {
		t.Fatalf("expected a reply hit to expose the whole thread, got %s", got)
	}
	for _, invalidQuery := range []string{"?page=0", "?page=nope", "?pageSize=0", "?pageSize=101", "?q=" + strings.Repeat("x", 201)} {
		response := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries/comments"+invalidQuery, nil)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d", invalidQuery, response.Code)
		}
	}
}

func TestCommentModerationEndpointsAndPublicHiddenSearch(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {})
	title := "Moderation endpoints"
	content, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "moderation-endpoints", Title: &title, Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(content.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}
	token := adminToken(t, router)

	created := request(t, router, http.MethodPost, "/api/v1/content/moderation-endpoints/comments", strings.NewReader(`{"authorName":"Original","authorUrl":"https://original.example","body":"hidden keyword","avatarSeed":"original-seed"}`))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d %s", created.Code, created.Body.String())
	}
	var root struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &root); err != nil {
		t.Fatal(err)
	}
	reply := request(t, router, http.MethodPost, "/api/v1/content/moderation-endpoints/comments", strings.NewReader(fmt.Sprintf(`{"body":"visible reply","replyToId":%q}`, root.ID)))
	if reply.Code != http.StatusCreated {
		t.Fatalf("expected reply 201, got %d %s", reply.Code, reply.Body.String())
	}

	hide := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/"+root.ID+"/hide", "")
	if hide.Code != http.StatusNoContent {
		t.Fatalf("expected hide 204, got %d %s", hide.Code, hide.Body.String())
	}
	detail := request(t, router, http.MethodGet, "/api/v1/content/moderation-endpoints?trackView=false", nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"commentCount":1`) {
		t.Fatalf("expected hidden root to leave visible reply counted, got %d %s", detail.Code, detail.Body.String())
	}
	var public struct {
		Data []struct {
			ID         string  `json:"id"`
			Hidden     bool    `json:"hidden"`
			AuthorName string  `json:"authorName"`
			AuthorURL  *string `json:"authorUrl"`
			Body       string  `json:"body"`
			AvatarSeed string  `json:"avatarSeed"`
		} `json:"data"`
		Pagination struct {
			TotalItems int `json:"totalItems"`
		} `json:"pagination"`
	}
	loadPublic := func(query string) {
		t.Helper()
		response := request(t, router, http.MethodGet, "/api/v1/content/moderation-endpoints/comments"+query, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("expected public comments 200 for %s, got %d %s", query, response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &public); err != nil {
			t.Fatal(err)
		}
	}
	loadPublic("")
	if len(public.Data) != 2 || !public.Data[0].Hidden || public.Data[0].AuthorName != "" || public.Data[0].AuthorURL != nil || public.Data[0].Body != "" || public.Data[0].AvatarSeed != "" || public.Data[1].Hidden {
		t.Fatalf("expected hidden comment details to be redacted in public response, got %+v", public.Data)
	}
	loadPublic("?q=hidden%20keyword")
	if public.Pagination.TotalItems != 0 || len(public.Data) != 0 {
		t.Fatalf("expected hidden author/body excluded from public search, got %+v", public)
	}
	loadPublic("?q=visible%20reply")
	if public.Pagination.TotalItems != 2 || len(public.Data) != 2 || !public.Data[0].Hidden {
		t.Fatalf("expected visible reply search to retain hidden root placeholder, got %+v", public)
	}

	adminList := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments?contentId="+content.ID, "")
	if adminList.Code != http.StatusOK || !strings.Contains(adminList.Body.String(), `"hiddenAt":"20`) {
		t.Fatalf("expected admin list to expose hiddenAt, got %d %s", adminList.Code, adminList.Body.String())
	}
	unhide := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/"+root.ID+"/unhide", "")
	if unhide.Code != http.StatusNoContent {
		t.Fatalf("expected unhide 204, got %d %s", unhide.Code, unhide.Body.String())
	}
	updated := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/comments/"+root.ID, `{"authorName":"Edited","authorUrl":null,"avatarSeed":"edited-seed"}`)
	if updated.Code != http.StatusNoContent {
		t.Fatalf("expected author update 204, got %d %s", updated.Code, updated.Body.String())
	}
	for _, body := range []string{`{"authorName":null}`, `{"avatarSeed":null}`} {
		if response := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/comments/"+root.ID, body); response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected null author field %s to return 422, got %d %s", body, response.Code, response.Body.String())
		}
	}
	loadPublic("")
	if public.Data[0].Hidden || public.Data[0].AuthorName != "Edited" || public.Data[0].Body != "hidden keyword" {
		t.Fatalf("expected updated author to be public after unhide, got %+v", public.Data[0])
	}

	deleted := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/comments/"+root.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d %s", deleted.Code, deleted.Body.String())
	}
	for _, path := range []string{"/hide", "/unhide"} {
		if response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/"+root.ID+path, ""); response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected deleted comment %s to return 422, got %d %s", path, response.Code, response.Body.String())
		}
	}
	if response := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/comments/"+root.ID, `{"authorName":"Nope"}`); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected deleted comment update to return 422, got %d %s", response.Code, response.Body.String())
	}
	if response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/comments/missing/hide", ""); response.Code != http.StatusNotFound {
		t.Fatalf("expected missing comment hide to return 404, got %d", response.Code)
	}
}

func TestCommentWithoutAuthorNameUsesAnonymous(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"body":"A useful note."}`))
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"authorName":"Anonymous"`) {
		t.Fatalf("expected normalized anonymous author, got %d %s", response.Code, response.Body.String())
	}
}

func TestPresenceCountsRecentVisitors(t *testing.T) {
	router := newTestRouter(t)
	first := requestWithVisitor(t, router, http.MethodPost, "/api/v1/presence", "visitor-a")
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"activeVisitors":1`) {
		t.Fatalf("expected one active visitor, got %d %s", first.Code, first.Body.String())
	}
	second := requestWithVisitor(t, router, http.MethodPost, "/api/v1/presence", "visitor-b")
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"activeVisitors":2`) {
		t.Fatalf("expected two active visitors, got %d %s", second.Code, second.Body.String())
	}
	invalid := requestWithVisitor(t, router, http.MethodPost, "/api/v1/presence", "short")
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected invalid visitor id 400, got %d %s", invalid.Code, invalid.Body.String())
	}
}

func TestContentLikeFlowIsIdempotentAndVisitorScoped(t *testing.T) {
	router := newTestRouter(t)

	initial := requestWithVisitor(t, router, http.MethodGet, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"likeCount":0`) {
		t.Fatalf("expected empty like summary, got %d %s", initial.Code, initial.Body.String())
	}
	liked := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if liked.Code != http.StatusOK || !strings.Contains(liked.Body.String(), `"likeCount":1`) || !strings.Contains(liked.Body.String(), `"viewerLiked":true`) {
		t.Fatalf("expected visitor like, got %d %s", liked.Code, liked.Body.String())
	}
	repeated := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if repeated.Code != http.StatusOK || !strings.Contains(repeated.Body.String(), `"likeCount":1`) {
		t.Fatalf("expected idempotent like, got %d %s", repeated.Code, repeated.Body.String())
	}
	otherVisitor := requestWithVisitor(t, router, http.MethodGet, "/api/v1/content/designing-boundaries/likes", "visitor-b")
	if otherVisitor.Code != http.StatusOK || !strings.Contains(otherVisitor.Body.String(), `"viewerLiked":false`) {
		t.Fatalf("expected visitor-scoped state, got %d %s", otherVisitor.Code, otherVisitor.Body.String())
	}
	unliked := requestWithVisitor(t, router, http.MethodDelete, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if unliked.Code != http.StatusOK || !strings.Contains(unliked.Body.String(), `"likeCount":0`) {
		t.Fatalf("expected like removal, got %d %s", unliked.Code, unliked.Body.String())
	}
	missingVisitor := request(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", nil)
	if missingVisitor.Code != http.StatusBadRequest || !strings.Contains(missingVisitor.Body.String(), "VISITOR_ID_INVALID") {
		t.Fatalf("expected missing visitor id 400, got %d %s", missingVisitor.Code, missingVisitor.Body.String())
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
	if recorder.Header().Get("X-Request-ID") != "req_test_1" || recorder.Header().Get("X-Trace-ID") != "trace_test_1" {
		t.Fatalf("expected propagated correlation headers, got %q %q", recorder.Header().Get("X-Request-ID"), recorder.Header().Get("X-Trace-ID"))
	}
	if !strings.Contains(recorder.Body.String(), `"requestId":"req_test_1"`) || !strings.Contains(recorder.Body.String(), `"traceId":"trace_test_1"`) {
		t.Fatalf("expected correlation ids in error body, got %s", recorder.Body.String())
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
}

func TestWriteOperationsCreateAuditEvents(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {})
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Reader","body":"A useful note."}`))
	req.Header.Set("X-Request-ID", "req_audit_test")
	req.Header.Set("X-Trace-ID", "trace_audit_test")
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected comment 201, got %d", recorder.Code)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		count, err := database.AuditEventCount()
		if err != nil {
			t.Fatal(err)
		}
		if count == 2 { // comment.created + content.viewed from prior seeded reads can vary; accept >=1 below
			break
		}
		if time.Now().After(deadline) {
			if count < 1 {
				t.Fatalf("expected audit events to settle, got %d", count)
			}
			break
		}
		time.Sleep(time.Millisecond)
	}
	var requestID, traceID string
	if err := database.DB.QueryRow(`SELECT request_id, trace_id FROM audit_events WHERE request_id = 'req_audit_test' LIMIT 1`).Scan(&requestID, &traceID); err != nil {
		t.Fatal(err)
	}
	if requestID != "req_audit_test" || traceID != "trace_audit_test" {
		t.Fatalf("expected audit correlation IDs, got request=%q trace=%q", requestID, traceID)
	}
}

func TestAdminRequiresBearerToken(t *testing.T) {
	router := newTestRouter(t)
	if response := request(t, router, http.MethodGet, "/api/v1/admin/content", nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestAdminLoginReturnsJWT(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("expected login 200, got %d", response.Code)
	}
	var session struct {
		ExpiresIn int `json:"expiresIn"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.ExpiresIn != 43200 {
		t.Fatalf("expected expiresIn derived from the 12h TTL, got %d", session.ExpiresIn)
	}
}

func TestAdminCreateCommentOnContent(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"draft-probe","title":null,"summary":"Draft probe.","body":"Draft body.","tags":["probe"],"metadata":{"mood":null,"question":null,"context":null,"source":null}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected draft creation 201, got %d %s", created.Code, created.Body.String())
	}
	var draft struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}

	anonymous := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+draft.ID+"/comments", `{"body":"Second note."}`)
	if anonymous.Code != http.StatusCreated || !strings.Contains(anonymous.Body.String(), `"authorName":"Anonymous"`) {
		t.Fatalf("expected anonymous fallback, got %d %s", anonymous.Code, anonymous.Body.String())
	}
	list := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments?contentId="+draft.ID, "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"totalItems":1`) || !strings.Contains(list.Body.String(), `"contentKind":"THOUGHT"`) {
		t.Fatalf("expected the admin comment on the draft, got %d %s", list.Code, list.Body.String())
	}
	if response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/missing/comments", `{"body":"Orphan."}`); response.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown content, got %d", response.Code)
	}
}

func TestAdminCommentsListFiltersPaginatesAndFocuses(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {})
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, created_at, deleted_at) VALUES
		('adm-root-1', 'content_1', 'Ada', 'First admin root', '2026-01-01T00:00:00Z', NULL),
		('adm-root-2', 'content_1', 'Grace', 'Second admin root', '2026-01-02T00:00:00Z', NULL),
		('adm-root-3', 'content_1', 'Linus', 'Third admin root', '2026-01-03T00:00:00Z', '2026-01-05T00:00:00Z'),
		('adm-root-4', 'content_1', 'Edsger', 'Fourth admin root', '2026-01-04T00:00:00Z', NULL),
		('thought-root', 'content_2', 'Ada', 'Thought admin root', '2026-01-06T00:00:00Z', NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`INSERT INTO comments (id, content_id, author_name, body, created_at, reply_to_id) VALUES ('adm-reply-1', 'content_1', 'Ada', 'an admin needle reply', '2026-01-05T00:00:00Z', 'adm-root-2')`); err != nil {
		t.Fatal(err)
	}
	token := adminToken(t, router)

	var page struct {
		Data []struct {
			ID          string  `json:"id"`
			ContentKind string  `json:"contentKind"`
			ContentSlug *string `json:"contentSlug"`
			DeletedAt   *string `json:"deletedAt"`
		} `json:"data"`
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			TotalItems int `json:"totalItems"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
	}
	load := func(query string) {
		t.Helper()
		response := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments"+query, "")
		if response.Code != http.StatusOK {
			t.Fatalf("expected admin comments 200 for %s, got %d %s", query, response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
	}
	ids := func() string {
		values := make([]string, 0, len(page.Data))
		for _, item := range page.Data {
			values = append(values, item.ID)
		}
		return strings.Join(values, ",")
	}

	load("?contentId=content_1&pageSize=2&page=1")
	if got, want := ids(), "adm-root-4,adm-root-3"; got != want {
		t.Fatalf("expected newest roots first with deleted included, got %s", got)
	}
	if page.Pagination.TotalItems != 5 || page.Pagination.TotalPages != 2 {
		t.Fatalf("unexpected pagination meta: %+v", page.Pagination)
	}
	for _, item := range page.Data {
		if item.ContentKind != "ARTICLE" || item.ContentSlug == nil || *item.ContentSlug != "designing-boundaries" {
			t.Fatalf("expected joined content fields on %s, got %+v", item.ID, item)
		}
	}
	if page.Data[1].DeletedAt == nil {
		t.Fatalf("expected the soft-deleted root to carry deletedAt, got %+v", page.Data[1])
	}
	load("?contentId=content_1&pageSize=2&focus=adm-reply-1")
	if page.Pagination.Page != 2 || !strings.Contains(ids(), "adm-reply-1") {
		t.Fatalf("expected focus on a reply to land on its thread page, got page %d ids %s", page.Pagination.Page, ids())
	}
	for _, invalidQuery := range []string{"?page=0", "?pageSize=101", "?q=" + strings.Repeat("x", 201), "?focus=" + strings.Repeat("x", 65)} {
		if response := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments"+invalidQuery, ""); response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d", invalidQuery, response.Code)
		}
	}
	if response := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/comments?contentId=missing", ""); response.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown contentId, got %d", response.Code)
	}
}

func TestAdminContentCreateUpdateAndConflict(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	create := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"versioned-thought","title":"Before","summary":"","body":"Body","tags":[],"metadata":{"mood":"calm","question":null,"context":null,"source":null}}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d %s", create.Code, create.Body.String())
	}
	var content struct {
		ID       string `json:"id"`
		Version  int    `json:"version"`
		Status   string `json:"status"`
		Metadata struct {
			Mood *string `json:"mood"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	if content.Status != "DRAFT" || content.Metadata.Mood == nil || *content.Metadata.Mood != "calm" {
		t.Fatalf("expected DRAFT with typed metadata echo, got %s", create.Body.String())
	}

	put := func(body string) *httptest.ResponseRecorder {
		return adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/content/"+content.ID, body)
	}
	response := put(`{"kind":"THOUGHT","slug":"versioned-thought","title":"After","summary":"","body":"Body","tags":[],"metadata":{"mood":"calm","question":null,"context":null,"source":null},"expectedVersion":1}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"title":"After"`) {
		t.Fatalf("expected partial update 200, got %d %s", response.Code, response.Body.String())
	}
	response = put(`{"kind":"THOUGHT","slug":"versioned-thought","title":"Stale","summary":"","body":"Body","tags":[],"metadata":{"mood":"calm","question":null,"context":null,"source":null},"expectedVersion":1}`)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "VERSION_CONFLICT") {
		t.Fatalf("expected version conflict 409, got %d %s", response.Code, response.Body.String())
	}
	response = put(`{"expectedVersion":3}`)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected empty patch 422, got %d %s", response.Code, response.Body.String())
	}

	// Slug collisions surface as a dedicated error code.
	duplicate := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"versioned-thought","title":null,"summary":"","body":"Body","tags":[],"metadata":{"mood":null,"question":null,"context":null,"source":null}}`)
	if duplicate.Code != http.StatusConflict || !strings.Contains(duplicate.Body.String(), "SLUG_TAKEN") {
		t.Fatalf("expected slug conflict 409, got %d %s", duplicate.Code, duplicate.Body.String())
	}

	// Derived metadata fields are rejected as input.
	derived := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"derived-reject","title":"Reject","summary":"","body":"Body","tags":[],"metadata":{"language":null,"aiAssisted":false,"readingMinutes":5}}`)
	if derived.Code != http.StatusUnprocessableEntity || !strings.Contains(derived.Body.String(), "derived by Core") {
		t.Fatalf("expected derived-field rejection 422, got %d %s", derived.Code, derived.Body.String())
	}

	// Kind semantics: articles require a title.
	untitled := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"untitled","title":null,"summary":"","body":"Body","tags":[],"metadata":{"language":null,"aiAssisted":false}}`)
	if untitled.Code != http.StatusUnprocessableEntity || !strings.Contains(untitled.Body.String(), "articles require a title") {
		t.Fatalf("expected article title rule 422, got %d %s", untitled.Code, untitled.Body.String())
	}
}

func TestAdminContentRecycleBinRestore(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"recycled","title":"Recycled","summary":"","body":"Body","tags":[],"metadata":{"mood":null,"question":null,"context":null,"source":null}}`)
	var content struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}

	deleted := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/content/"+content.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d %s", deleted.Code, deleted.Body.String())
	}
	// DELETED rows appear only under the explicit status filter.
	defaultList := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/content", "")
	if defaultList.Code != http.StatusOK || strings.Contains(defaultList.Body.String(), content.ID) {
		t.Fatalf("expected deleted content to stay out of the default admin list, got %s", defaultList.Body.String())
	}
	recycleBin := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/content?status=DELETED", "")
	if recycleBin.Code != http.StatusOK || !strings.Contains(recycleBin.Body.String(), content.ID) {
		t.Fatalf("expected deleted content in recycle bin filter, got %s", recycleBin.Body.String())
	}
	restored := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+content.ID+"/restore", "")
	if restored.Code != http.StatusOK || !strings.Contains(restored.Body.String(), `"status":"DRAFT"`) {
		t.Fatalf("expected restore to DRAFT 200, got %d %s", restored.Code, restored.Body.String())
	}
	if missing := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/missing/restore", ""); missing.Code != http.StatusNotFound {
		t.Fatalf("expected restore of unknown id 404, got %d", missing.Code)
	}
}

func TestContentTransitionsKeepFirstPublishedAt(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	publish := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/publish", "")
	if publish.Code != http.StatusOK {
		t.Fatalf("expected republish 200, got %d %s", publish.Code, publish.Body.String())
	}
	var published struct {
		PublishedAt string `json:"publishedAt"`
	}
	if err := json.Unmarshal(publish.Body.Bytes(), &published); err != nil {
		t.Fatal(err)
	}
	unpublish := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/unpublish", "")
	if unpublish.Code != http.StatusOK || !strings.Contains(unpublish.Body.String(), `"publishedAt":"`+published.PublishedAt+`"`) {
		t.Fatalf("expected unpublish to keep original publishedAt, got %s", unpublish.Body.String())
	}
	missing := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected unpublished content 404, got %d", missing.Code)
	}
	republish := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/publish", "")
	if republish.Code != http.StatusOK || !strings.Contains(republish.Body.String(), `"publishedAt":"`+published.PublishedAt+`"`) {
		t.Fatalf("expected republish to keep original publishedAt, got %s", republish.Body.String())
	}
}

func TestPublicCacheInvalidatesAfterAdminUpdate(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	initial := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"title":"Designing Boundaries"`) {
		t.Fatalf("expected initial public content, got %d %s", initial.Code, initial.Body.String())
	}
	updated := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/content/content_1", `{"kind":"ARTICLE","slug":"designing-boundaries","title":"Updated Boundaries","summary":"Notes on designing boundaries in personal systems.","body":"# Designing Boundaries\n\nA personal system should preserve attention and make the next action clear.\n\n## The boundary\n\nSmall interfaces reduce unnecessary decisions.","tags":["systems","design"],"metadata":{"language":"Go","aiAssisted":false},"expectedVersion":1}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("expected content update 200, got %d %s", updated.Code, updated.Body.String())
	}
	refreshed := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"title":"Updated Boundaries"`) {
		t.Fatalf("expected invalidated public content, got %d %s", refreshed.Code, refreshed.Body.String())
	}

	// Like mutations must also drop the cached detail so likeCount never
	// goes stale for the TTL window.
	liked := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", "visitor-a")
	if liked.Code != http.StatusOK {
		t.Fatalf("expected like 200, got %d", liked.Code)
	}
	detail := request(t, router, http.MethodGet, "/api/v1/content/designing-boundaries?trackView=false", nil)
	if !strings.Contains(detail.Body.String(), `"likeCount":1`) {
		t.Fatalf("expected refreshed like count on cached detail, got %s", detail.Body.String())
	}
}

func TestStatsSnapshotInvalidatesAfterPublishingContent(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	initial := request(t, router, http.MethodGet, "/api/v1/stats", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"contentCount":20`) {
		t.Fatalf("expected initial stats, got %d %s", initial.Code, initial.Body.String())
	}
	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"stats-snapshot-thought","title":"Snapshot","summary":"","body":"one two","tags":[],"metadata":{"mood":null,"question":null,"context":null,"source":null}}`)
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
	if refreshed.Code != http.StatusOK || !strings.Contains(refreshed.Body.String(), `"contentCount":21`) {
		t.Fatalf("expected invalidated stats snapshot, got %d %s", refreshed.Code, refreshed.Body.String())
	}
}

func TestFeaturedContentLivesOnSiteComposition(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	site := request(t, router, http.MethodGet, "/api/v1/site", nil)
	if site.Code != http.StatusOK {
		t.Fatalf("expected site 200, got %d", site.Code)
	}
	var composition struct {
		Title          string                   `json:"title"`
		PinnedThoughts []struct{ Slug string } `json:"pinnedThoughts"`
		PinnedWritings []struct{ Slug string } `json:"pinnedWritings"`
	}
	if err := json.Unmarshal(site.Body.Bytes(), &composition); err != nil {
		t.Fatal(err)
	}
	// Pins are explicit: with none configured the site carries empty arrays.
	if len(composition.PinnedWritings) != 0 {
		t.Fatalf("expected no pinned writings by default, got %s", site.Body.String())
	}
	if len(composition.PinnedThoughts) != 0 {
		t.Fatalf("expected no pinned thoughts by default, got %s", site.Body.String())
	}

	pin := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/writings/config", `{"pinnedIds":["content_1"]}`)
	if pin.Code != http.StatusOK || !strings.Contains(pin.Body.String(), `"pinnedIds":["content_1"]`) {
		t.Fatalf("expected writing pin update 200, got %d %s", pin.Code, pin.Body.String())
	}
	updated := request(t, router, http.MethodGet, "/api/v1/site", nil)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"pinnedWritings":[{"id":"content_1"`) {
		t.Fatalf("expected site to reflect the pinned writing, got %s", updated.Body.String())
	}
	if invalidPin := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/writings/config", `{"pinnedIds":["content_2"]}`); invalidPin.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected a THOUGHT id to be rejected as writing pin, got %d", invalidPin.Code)
	}
	if duplicatePin := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/writings/config", `{"pinnedIds":["content_1","content_1"]}`); duplicatePin.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected duplicate pin ids to be rejected, got %d", duplicatePin.Code)
	}
	if clear := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/writings/config", `{"pinnedIds":[]}`); clear.Code != http.StatusOK || !strings.Contains(clear.Body.String(), `"pinnedIds":[]`) {
		t.Fatalf("expected pin clear 200, got %d %s", clear.Code, clear.Body.String())
	}
}

func TestSiteSettingsValidationAndCommentsToggle(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	invalid := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/site", `{"title":"X","description":"","footer":"","social":[],"commentsEnabled":true,"navigation":[{"label":"Thoughts","href":"/thoughts"}],"sections":["NOT_A_SECTION"]}`)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected invalid sections to be rejected with 422, got %d", invalid.Code)
	}
	update := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/site", `{"title":"Garden","description":"A calm garden.","footer":"Keep notes moving.","social":[{"label":"GitHub","href":"https://github.com/manifold-space/manifold","external":true}],"commentsEnabled":false,"navigation":[{"label":"Thoughts","href":"/thoughts"}],"sections":["PROFILE","CONTACT"]}`)
	if update.Code != http.StatusOK || !strings.Contains(update.Body.String(), `"commentsEnabled":false`) {
		t.Fatalf("expected site update 200, got %d %s", update.Code, update.Body.String())
	}
	disabled := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Guest","body":"Hello"}`))
	if disabled.Code != http.StatusForbidden || !strings.Contains(disabled.Body.String(), "COMMENT_DISABLED") {
		t.Fatalf("expected comments toggle to reject public comments 403, got %d", disabled.Code)
	}
	// Admin replies bypass the public toggle by design.
	adminComment := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/content_1/comments", `{"body":"Author reply"}`)
	if adminComment.Code != http.StatusCreated {
		t.Fatalf("expected admin comment to bypass toggle, got %d %s", adminComment.Code, adminComment.Body.String())
	}
	enabled := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/site", `{"title":"Garden","description":"","footer":"","social":[],"commentsEnabled":true,"navigation":[{"label":"Thoughts","href":"/thoughts"}],"sections":["PROFILE"]}`)
	if enabled.Code != http.StatusOK {
		t.Fatalf("expected re-enable 200, got %d", enabled.Code)
	}
	publicComment := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"authorName":"Guest","body":"Hello"}`))
	if publicComment.Code != http.StatusCreated {
		t.Fatalf("expected re-enabled comments to accept posts, got %d", publicComment.Code)
	}
}

func TestAdminConfigurationManagement(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	profile := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/profile", `{"displayName":"Updated Garden","handle":"@updated","headline":"","bio":"","avatarUrl":"","location":"","organization":"","websiteUrl":"","resumeUrl":null,"interests":[],"education":[],"experience":[],"series":[{"name":"Relay","url":"https://relay.example","description":"A public relay","category":null}],"contacts":[{"label":"WhatsApp","url":"https://wa.me/123","handle":null,"icon":null}]}`)
	if profile.Code != http.StatusOK || !strings.Contains(profile.Body.String(), "Updated Garden") || !strings.Contains(profile.Body.String(), "Relay") {
		t.Fatalf("expected profile update 200, got %d %s", profile.Code, profile.Body.String())
	}
	if emptyName := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/profile", `{"displayName":"","handle":"","headline":"","bio":"","avatarUrl":"","location":"","organization":"","websiteUrl":"","resumeUrl":null,"interests":[],"education":[],"experience":[],"series":[],"contacts":[]}`); emptyName.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected empty display name 422, got %d", emptyName.Code)
	}
}

func TestOverviewAndAnalytics(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	if liked := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/designing-boundaries/likes", "visitor-a"); liked.Code != http.StatusOK {
		t.Fatalf("expected like 200, got %d", liked.Code)
	}
	overview := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/overview", "")
	if overview.Code != http.StatusOK {
		t.Fatalf("expected overview 200, got %d", overview.Code)
	}
	var decoded struct {
		Content struct {
			ContentCount int `json:"contentCount"`
			ArticleCount int `json:"articleCount"`
			ThoughtCount int `json:"thoughtCount"`
			TotalLikes   int `json:"totalLikes"`
		} `json:"content"`
		TopContent []struct {
			ID string `json:"id"`
		} `json:"topContent"`
		Trend struct {
			Monthly []struct {
				Month string `json:"month"`
			} `json:"monthly"`
		} `json:"trend"`
	}
	if err := json.Unmarshal(overview.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Content.ContentCount != 20 || decoded.Content.ArticleCount != 11 || decoded.Content.ThoughtCount != 9 || decoded.Content.TotalLikes != 1 {
		t.Fatalf("unexpected overview counts: %+v", decoded.Content)
	}
	if len(decoded.TopContent) != 5 || len(decoded.Trend.Monthly) != 12 {
		t.Fatalf("expected top content and 12 trend months, got %+v", decoded.Trend.Monthly)
	}

	views := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/analytics/views?days=7", "")
	if views.Code != http.StatusOK {
		t.Fatalf("expected analytics 200, got %d", views.Code)
	}
	system := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/system", "")
	if system.Code != http.StatusOK || !strings.Contains(system.Body.String(), `"uptimeSeconds"`) {
		t.Fatalf("expected system status, got %d %s", system.Code, system.Body.String())
	}
	if badDays := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/analytics/views?days=0", ""); badDays.Code != http.StatusBadRequest {
		t.Fatalf("expected days=0 400, got %d", badDays.Code)
	}
}

func TestAuditListExposesCorrelationIDs(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	audit := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/audit?page=1&pageSize=3", "")
	if audit.Code != http.StatusOK {
		t.Fatalf("expected audit 200, got %d %s", audit.Code, audit.Body.String())
	}
	var events struct {
		Events []struct {
			ID        string  `json:"id"`
			RequestID *string `json:"requestId"`
			TraceID   *string `json:"traceId"`
		} `json:"events"`
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			TotalItems int `json:"totalItems"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(audit.Body.Bytes(), &events); err != nil {
		t.Fatal(err)
	}
	if len(events.Events) == 0 || events.Events[0].RequestID == nil {
		t.Fatalf("expected audit rows to carry requestId, got %s", audit.Body.String())
	}
	if events.Pagination.PageSize != 3 {
		t.Fatalf("expected pageSize echo, got %+v", events.Pagination)
	}
}

func TestRateLimitingProtectsPublicWrites(t *testing.T) {
	router, _ := newTestRouterWithConfig(t, func(cfg *config.Config) { cfg.LoginRatePerMin = 3; cfg.RateLimitPerMin = 0 })

	// Login bursts are capped; the limiter keys on the same test remote addr.
	codes := []int{}
	for i := 0; i < 5; i++ {
		response := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
		codes = append(codes, response.Code)
	}
	sawLimit := false
	for _, code := range codes {
		if code == http.StatusTooManyRequests {
			sawLimit = true
		}
	}
	if !sawLimit {
		t.Fatalf("expected a 429 within the login burst, got %v", codes)
	}

	// Unthrottled writes still succeed when the general limiter is disabled.
	comment := request(t, router, http.MethodPost, "/api/v1/content/designing-boundaries/comments", strings.NewReader(`{"body":"A useful note."}`))
	if comment.Code != http.StatusCreated {
		t.Fatalf("expected comment 201 with general limiting disabled, got %d %s", comment.Code, comment.Body.String())
	}
}

func TestMediaLifecycle(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	if unauthorized := request(t, router, http.MethodPost, "/api/v1/admin/media?filename=a.png", bytes.NewReader(png)); unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized media upload, got %d", unauthorized.Code)
	}
	uploaded := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=probe.png", string(png))
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("expected media upload created, got %d %s", uploaded.Code, uploaded.Body.String())
	}
	var media struct {
		ID   string `json:"id"`
		URL  string `json:"url"`
		Mime string `json:"mime"`
		Size int    `json:"size"`
	}
	if err := json.Unmarshal(uploaded.Body.Bytes(), &media); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(media.ID, "media_") || !strings.HasPrefix(media.URL, "http://example.com/api/v1/media/") || media.Mime != "image/png" || media.Size != len(png) {
		t.Fatalf("unexpected media payload: %+v", media)
	}
	retrieved := request(t, router, http.MethodGet, "/api/v1/media/"+media.ID, nil)
	if retrieved.Code != http.StatusOK || retrieved.Header().Get("Content-Type") != "image/png" || !strings.Contains(retrieved.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("expected served image with cache headers, got %d %v", retrieved.Code, retrieved.Header())
	}
	reuploaded := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=again.png", string(png))
	var deduped struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(reuploaded.Body.Bytes(), &deduped); err != nil {
		t.Fatal(err)
	}
	if reuploaded.Code != http.StatusCreated || deduped.ID != media.ID {
		t.Fatalf("expected dedupe to the same media id, got %s vs %s", deduped.ID, media.ID)
	}
	if rejected := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=x.txt", "plain text not an image"); rejected.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected non-image upload 415, got %d", rejected.Code)
	}
	if rejectedSVG := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=x.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"); rejectedSVG.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected SVG upload 415, got %d", rejectedSVG.Code)
	}
	deleted := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/media/"+media.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("expected media deletion 204, got %d", deleted.Code)
	}
	if gone := request(t, router, http.MethodGet, "/api/v1/media/"+media.ID, nil); gone.Code != http.StatusNotFound {
		t.Fatalf("expected deleted media 404, got %d", gone.Code)
	}
}

func TestMediaReferencesEndpoint(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	uploaded := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=refs.png", string(png))
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("expected media upload created, got %d %s", uploaded.Code, uploaded.Body.String())
	}
	var media struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := json.Unmarshal(uploaded.Body.Bytes(), &media); err != nil {
		t.Fatal(err)
	}
	if unauthorized := request(t, router, http.MethodGet, "/api/v1/admin/media/"+media.ID+"/references", nil); unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized references read, got %d", unauthorized.Code)
	}
	empty := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/media/"+media.ID+"/references", "")
	if empty.Code != http.StatusOK {
		t.Fatalf("expected empty references 200, got %d %s", empty.Code, empty.Body.String())
	}
	var before struct {
		References []model.MediaReference `json:"references"`
	}
	if err := json.Unmarshal(empty.Body.Bytes(), &before); err != nil {
		t.Fatal(err)
	}
	if len(before.References) != 0 {
		t.Fatalf("expected no references before content links the media, got %+v", before.References)
	}
	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"media-refs-probe","title":"Uses media","summary":"Summary.","body":"See ![probe](`+media.URL+`)","tags":[],"metadata":{"language":null,"aiAssisted":false}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected content created, got %d %s", created.Code, created.Body.String())
	}
	var content struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	list := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/media/"+media.ID+"/references", "")
	if list.Code != http.StatusOK {
		t.Fatalf("expected references 200, got %d %s", list.Code, list.Body.String())
	}
	var after struct {
		References []model.MediaReference `json:"references"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if len(after.References) != 1 {
		t.Fatalf("expected one reference, got %+v", after.References)
	}
	ref := after.References[0]
	if ref.ContentID != content.ID || ref.Kind != model.ContentKindArticle || ref.Slug != "media-refs-probe" || ref.Status != model.StatusDraft {
		t.Fatalf("unexpected reference payload: %+v", ref)
	}
	if ref.Title == nil || *ref.Title != "Uses media" {
		t.Fatalf("expected reference title, got %+v", ref.Title)
	}
}

func TestMediaUploadSizeLimit(t *testing.T) {
	router, _ := newTestRouterWithConfig(t, func(cfg *config.Config) { cfg.MediaMaxBytes = 8 })
	token := adminToken(t, router)
	oversize := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=big.png", strings.Repeat("a", 64))
	if oversize.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected oversize upload 413, got %d", oversize.Code)
	}
}

func TestMediaPdfUpload(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	pdf := []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")
	uploaded := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=resume.pdf", string(pdf))
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("expected PDF upload created, got %d %s", uploaded.Code, uploaded.Body.String())
	}
	var media struct {
		ID   string `json:"id"`
		URL  string `json:"url"`
		Mime string `json:"mime"`
		Size int    `json:"size"`
	}
	if err := json.Unmarshal(uploaded.Body.Bytes(), &media); err != nil {
		t.Fatal(err)
	}
	if media.Mime != "application/pdf" || media.Size != len(pdf) {
		t.Fatalf("unexpected PDF payload: %+v", media)
	}
	retrieved := request(t, router, http.MethodGet, "/api/v1/media/"+media.ID, nil)
	if retrieved.Code != http.StatusOK || retrieved.Header().Get("Content-Type") != "application/pdf" || !strings.Contains(retrieved.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("expected served PDF with cache headers, got %d %v", retrieved.Code, retrieved.Header())
	}
	if garbage := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=fake.pdf", "plain text pretending to be a pdf"); garbage.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected fake PDF upload 415, got %d", garbage.Code)
	}
}

func TestMetadataValidationRejectsWrongTypes(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)
	for i, item := range []struct {
		kind     string
		metadata string
	}{
		{"THOUGHT", `{"source":42}`},
		{"ARTICLE", `{"technologies":["Go",42]}`},
		{"ARTICLE", `{"frontmatter":{"series":42}}`},
		{"ARTICLE", `{"difficulty":"EXPERT"}`},
		{"ARTICLE", `{"aiAssisted":"yes"}`},
	} {
		body := fmt.Sprintf(`{"kind":%q,"slug":"invalid-%d","title":"Invalid","summary":"","body":"Body","tags":[],"metadata":%s}`, item.kind, i, item.metadata)
		invalid := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", body)
		if invalid.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected metadata rejection 422 for %s, got %d %s", item.metadata, invalid.Code, invalid.Body.String())
		}
	}
}

func TestAdminChangePasswordRevokesOtherSessions(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)
	response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/password", `{"currentPassword":"password","newPassword":"new-secret-9"}`)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected password change 204, got %d %s", response.Code, response.Body.String())
	}
	if bad := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/password", `{"currentPassword":"wrong","newPassword":"another-1"}`); bad.Code != http.StatusUnauthorized {
		t.Fatalf("expected wrong current password 401, got %d", bad.Code)
	}
	login := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"new-secret-9"}`))
	if login.Code != http.StatusOK {
		t.Fatalf("expected login with new password 200, got %d %s", login.Code, login.Body.String())
	}
}

func TestAdminLogoutRevokesCurrentSession(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)
	if response := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/session/logout", ""); response.Code != http.StatusNoContent {
		t.Fatalf("expected logout 204, got %d", response.Code)
	}
	if response := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/content", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("expected revoked token 401, got %d", response.Code)
	}
}

func TestAdminLogoutAllSessionsKeepsCurrent(t *testing.T) {
	router := newTestRouter(t)
	tokenA := adminToken(t, router)
	tokenB := adminToken(t, router)
	if response := adminRequest(t, router, tokenA, http.MethodPost, "/api/v1/admin/session/logout-all", ""); response.Code != http.StatusNoContent {
		t.Fatalf("expected logout-all 204, got %d", response.Code)
	}
	if response := adminRequest(t, router, tokenA, http.MethodGet, "/api/v1/admin/content", ""); response.Code != http.StatusOK {
		t.Fatalf("expected current session to stay valid, got %d", response.Code)
	}
	if response := adminRequest(t, router, tokenB, http.MethodGet, "/api/v1/admin/content", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("expected other session revoked, got %d", response.Code)
	}
}

func TestAdminListSessions(t *testing.T) {
	router := newTestRouter(t)
	tokenA := adminToken(t, router)
	_ = adminToken(t, router)
	response := adminRequest(t, router, tokenA, http.MethodGet, "/api/v1/admin/session/list", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected session list 200, got %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Sessions []struct {
			ID      string `json:"id"`
			Active  bool   `json:"active"`
			Current bool   `json:"current"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(body.Sessions))
	}
	current := 0
	for _, session := range body.Sessions {
		if !session.Active {
			t.Fatalf("expected all sessions active before logout-all, got %+v", session)
		}
		if session.Current {
			current++
		}
	}
	if current != 1 {
		t.Fatalf("expected exactly one current session, got %d", current)
	}
	// After logout-all the revoked session is soft-deleted: the list only
	// shows the current session.
	if response := adminRequest(t, router, tokenA, http.MethodPost, "/api/v1/admin/session/logout-all", ""); response.Code != http.StatusNoContent {
		t.Fatalf("expected logout-all 204, got %d", response.Code)
	}
	response = adminRequest(t, router, tokenA, http.MethodGet, "/api/v1/admin/session/list", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected session list 200 after logout-all, got %d", response.Code)
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 1 || !body.Sessions[0].Current || !body.Sessions[0].Active {
		t.Fatalf("expected only the current active session to remain, got %+v", body.Sessions)
	}
}

func TestAdminLogoutSessionByIDRevokesOneSession(t *testing.T) {
	router := newTestRouter(t)
	tokenA := adminToken(t, router)
	tokenB := adminToken(t, router)
	claimsB := decodeSessionID(t, tokenB)

	response := adminRequest(t, router, tokenA, http.MethodPost, "/api/v1/admin/session/"+claimsB+"/logout", "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected targeted logout 204, got %d %s", response.Code, response.Body.String())
	}
	// Only the targeted session died; the caller's stays valid.
	if response := adminRequest(t, router, tokenB, http.MethodGet, "/api/v1/admin/content", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("expected targeted session revoked, got %d", response.Code)
	}
	if response := adminRequest(t, router, tokenA, http.MethodGet, "/api/v1/admin/content", ""); response.Code != http.StatusOK {
		t.Fatalf("expected caller session to stay valid, got %d", response.Code)
	}
	// Revoking is idempotent; the soft-deleted session is gone from the list.
	if response := adminRequest(t, router, tokenA, http.MethodPost, "/api/v1/admin/session/"+claimsB+"/logout", ""); response.Code != http.StatusNoContent {
		t.Fatalf("expected repeat logout 204, got %d", response.Code)
	}
	list := adminRequest(t, router, tokenA, http.MethodGet, "/api/v1/admin/session/list", "")
	var body struct {
		Sessions []struct {
			ID string `json:"id"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 1 {
		t.Fatalf("expected soft-deleted session to leave the list, got %+v", body.Sessions)
	}
	// An unknown id is 404.
	if response := adminRequest(t, router, tokenA, http.MethodPost, "/api/v1/admin/session/sess_missing/logout", ""); response.Code != http.StatusNotFound {
		t.Fatalf("expected unknown session 404, got %d", response.Code)
	}
}

func TestMediaDeleteBlockedWhenReferenced(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	uploaded := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/media?filename=ref.png", string(png))
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("expected upload 201, got %d %s", uploaded.Code, uploaded.Body.String())
	}
	var media struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	_ = json.Unmarshal(uploaded.Body.Bytes(), &media)
	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"ref-media","title":null,"summary":"s","body":"![x](`+media.URL+`)","tags":[],"metadata":{"mood":null,"question":null,"context":null,"source":null}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected content 201, got %d %s", created.Code, created.Body.String())
	}
	blocked := adminRequest(t, router, token, http.MethodDelete, "/api/v1/admin/media/"+media.ID, "")
	if blocked.Code != http.StatusConflict {
		t.Fatalf("expected conflict 409, got %d", blocked.Code)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(blocked.Body.Bytes(), &body)
	if body.Error.Code != "MEDIA_IN_USE" {
		t.Fatalf("expected MEDIA_IN_USE, got %s", body.Error.Code)
	}
}

// --- Anchoring chain: business write paths produce certificates ---

// chainAnchorProbe reads one anchor row for assertions.
func chainAnchorProbe(t *testing.T, database *store.Store, query string, args ...any) map[string]any {
	t.Helper()
	var id, source, subjectRef, metadataJSON string
	var blockID *string
	if err := database.DB.QueryRow(`SELECT id, source, subject_ref, metadata_json, block_id FROM chain_anchors `+query, args...).Scan(&id, &source, &subjectRef, &metadataJSON, &blockID); err != nil {
		t.Fatalf("anchor probe %s: %v", query, err)
	}
	var metadata map[string]any
	_ = json.Unmarshal([]byte(metadataJSON), &metadata)
	return map[string]any{"id": id, "source": source, "subjectRef": subjectRef, "metadata": metadata, "blockID": blockID}
}

func TestChainAnchorsContentLifecycle(t *testing.T) {
	router, database := newTestRouterWithChain(t, nil)
	token := adminToken(t, router)

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"chain-piece","title":"Chain piece","summary":"s","body":"Body","tags":["go"],"metadata":{"language":null,"aiAssisted":false}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d %s", created.Code, created.Body.String())
	}
	var item struct{ ID string `json:"id"` }
	_ = json.Unmarshal(created.Body.Bytes(), &item)

	// create → content-source anchor recording DRAFT/v1
	anchor := chainAnchorProbe(t, database, `WHERE source = 'content' AND subject_ref = ? ORDER BY created_at ASC, id ASC LIMIT 1`, item.ID)
	if anchor["source"] != "content" {
		t.Fatalf("create must leave a content anchor: %v", anchor)
	}
	meta := anchor["metadata"].(map[string]any)
	if meta["status"] != "DRAFT" || meta["version"] != float64(1) || meta["slug"] != "chain-piece" {
		t.Fatalf("create anchor metadata mismatch: %v", meta)
	}

	// publish → second anchor carrying the same substance hash, PUBLISHED status
	published := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+item.ID+"/publish", "")
	if published.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", published.Code, published.Body.String())
	}
	anchors, err := database.DB.Query(`SELECT metadata_json FROM chain_anchors WHERE source = 'content' AND subject_ref = ?`, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	var statuses []string
	for anchors.Next() {
		var metadataJSON string
		if err := anchors.Scan(&metadataJSON); err != nil {
			t.Fatal(err)
		}
		var meta map[string]any
		_ = json.Unmarshal([]byte(metadataJSON), &meta)
		statuses = append(statuses, meta["status"].(string))
	}
	anchors.Close()
	rows, err := database.DB.Query(`SELECT subject_hash FROM chain_anchors WHERE source = 'content' AND subject_ref = ?`, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var hashes []string
	for rows.Next() {
		var hash string
		_ = rows.Scan(&hash)
		hashes = append(hashes, hash)
	}
	if len(statuses) != 2 || statuses[0] != "DRAFT" || statuses[1] != "PUBLISHED" {
		t.Fatalf("lifecycle anchors mismatch: %v", statuses)
	}
	// Same body, same substance: both lifecycle flips hash identically (docs/chain.md §4.1).
	if hashes[0] != hashes[1] {
		t.Fatalf("substance hash must be stable across lifecycle flips: %v", hashes)
	}
}

func TestChainAnchorsReactionAndCommentAndAuth(t *testing.T) {
	router, database := newTestRouterWithChain(t, nil)
	token := adminToken(t, router)

	// login already produced an auth anchor
	var authCount int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE source = 'auth'`).Scan(&authCount); err != nil {
		t.Fatal(err)
	}
	if authCount < 1 {
		t.Fatal("login must anchor an auth event")
	}

	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"THOUGHT","slug":"chain-thought","title":null,"summary":"s","body":"Thought body","tags":[],"metadata":{"mood":"calm","question":null,"context":null,"source":null}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d %s", created.Code, created.Body.String())
	}
	_ = adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+jsonStringField(t, created.Body.String(), "id")+"/publish", "")

	comment := request(t, router, http.MethodPost, "/api/v1/content/chain-thought/comments", strings.NewReader(`{"authorName":"alice","body":"Anchored reply","avatarSeed":"seed1"}`))
	if comment.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d %s", comment.Code, comment.Body.String())
	}
	anchor := chainAnchorProbe(t, database, `WHERE source = 'comment' ORDER BY created_at DESC, id DESC LIMIT 1`)
	if meta := anchor["metadata"].(map[string]any); meta["action"] != "created" {
		t.Fatalf("comment anchor action mismatch: %v", meta)
	}

	like := requestWithVisitor(t, router, http.MethodPut, "/api/v1/content/chain-thought/likes", "visitor_chain_1")
	if like.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", like.Code, like.Body.String())
	}
	anchor = chainAnchorProbe(t, database, `WHERE source = 'reaction' ORDER BY created_at DESC, id DESC LIMIT 1`)
	if meta := anchor["metadata"].(map[string]any); meta["action"] != "added" {
		t.Fatalf("reaction anchor action mismatch: %v", meta)
	}
}

func jsonStringField(t *testing.T, raw, field string) string {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatal(err)
	}
	value, _ := parsed[field].(string)
	return value
}

func TestChainPublicSubmitVerifyAndLatestAnchor(t *testing.T) {
	router, _ := newTestRouterWithChain(t, nil)
	token := adminToken(t, router)

	submit := request(t, router, http.MethodPost, "/api/v1/chain/anchors", strings.NewReader(`{"payload":"hello manifold","label":"demo"}`))
	if submit.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d %s", submit.Code, submit.Body.String())
	}
	var submitted struct{ AnchorID, SubjectHash string `json:"-"` }
	var raw map[string]any
	if err := json.Unmarshal(submit.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	submitted.AnchorID, _ = raw["anchorId"].(string)
	submitted.SubjectHash, _ = raw["subjectHash"].(string)
	if submitted.AnchorID == "" || raw["status"] != "pending" {
		t.Fatalf("unexpected submit response: %s", submit.Body.String())
	}

	// Round-trip by hash and by pasted payload; the miner confirms within a tick.
	deadline := time.Now().Add(3 * time.Second)
	anchored := false
	for time.Now().Before(deadline) {
		verify := request(t, router, http.MethodGet, "/api/v1/chain/verify?hash="+submitted.SubjectHash, nil)
		if verify.Code == http.StatusOK {
			var result map[string]any
			_ = json.Unmarshal(verify.Body.Bytes(), &result)
			anchor, _ := result["anchor"].(map[string]any)
			if blockID, _ := anchor["blockId"].(string); blockID != "" {
				if result["found"] != true || result["signatureValid"] != true || result["chainIntegrity"] != true {
					t.Fatalf("verify mismatch: %s", verify.Body.String())
				}
				anchored = true
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !anchored {
		t.Fatal("anchor never confirmed within deadline")
	}

	payloadVerify := request(t, router, http.MethodPost, "/api/v1/chain/verify", strings.NewReader(`{"payload":"hello manifold"}`))
	if payloadVerify.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", payloadVerify.Code)
	}
	var result map[string]any
	_ = json.Unmarshal(payloadVerify.Body.Bytes(), &result)
	if result["found"] != true {
		t.Fatalf("pasted payload must verify: %s", payloadVerify.Body.String())
	}

	// Admin channel requires JWT.
	unauthorized := request(t, router, http.MethodPost, "/api/v1/admin/chain/anchors", strings.NewReader(`{"payload":"x"}`))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthorized.Code)
	}

	// Oversized payload → 413.
	bigPayload := strings.Repeat("x", 70000)
	tooLarge := request(t, router, http.MethodPost, "/api/v1/chain/anchors", strings.NewReader(`{"payload":"`+bigPayload+`"}`))
	if tooLarge.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", tooLarge.Code)
	}

	// detail endpoint carries latestAnchor once content is anchored
	created := adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content", `{"kind":"ARTICLE","slug":"badge-piece","title":"Badge","summary":"s","body":"B","tags":[],"metadata":{"language":null,"aiAssisted":false}}`)
	id := jsonStringField(t, created.Body.String(), "id")
	_ = adminRequest(t, router, token, http.MethodPost, "/api/v1/admin/content/"+id+"/publish", "")
	detailDeadline := time.Now().Add(3 * time.Second)
	var latestAnchor any
	for time.Now().Before(detailDeadline) {
		detail := request(t, router, http.MethodGet, "/api/v1/content/badge-piece", nil)
		if detail.Code == http.StatusOK {
			var parsed struct {
				LatestAnchor *struct {
					AnchorID string `json:"anchorId"`
					Status  string `json:"status"`
				} `json:"latestAnchor"`
			}
			_ = json.Unmarshal(detail.Body.Bytes(), &parsed)
			if parsed.LatestAnchor != nil && parsed.LatestAnchor.Status == "anchored" {
				latestAnchor = parsed.LatestAnchor
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if latestAnchor == nil {
		t.Fatal("detail must expose an anchored latestAnchor")
	}

	// verify/content round trip for the same slug
	contentVerify := request(t, router, http.MethodGet, "/api/v1/chain/verify/content/badge-piece", nil)
	if contentVerify.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", contentVerify.Code, contentVerify.Body.String())
	}
	var contentResult map[string]any
	_ = json.Unmarshal(contentVerify.Body.Bytes(), &contentResult)
	if contentResult["found"] != true {
		t.Fatalf("content verify must hit: %s", contentVerify.Body.String())
	}
}
