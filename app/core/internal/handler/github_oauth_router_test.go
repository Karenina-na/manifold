package handler_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func enabledConfig() *config.Config {
	return &config.Config{
		JWTSecret: "test-secret", AdminUsername: "admin", AllowedOrigins: []string{"*"}, AuditEventBuffer: 256,
		GitHubClientID: "test-id", GitHubClientSecret: "test-secret", GitHubRedirectURI: "http://localhost:3000/api/v1/auth/callback/github",
	}
}

func TestAuthMeAnonymous(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodGet, "/api/v1/auth/me", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("expected authenticated false, got %v", body["authenticated"])
	}
	if providers, ok := body["providers"].([]any); !ok || len(providers) != 0 {
		t.Fatalf("expected no providers when GitHub is unconfigured, got %v", body["providers"])
	}
}

func TestAuthMeProvidersWhenConfigured(t *testing.T) {
	router, _ := newTestRouterWithConfig(t, func(cfg *config.Config) {
		*cfg = *enabledConfig()
	})
	response := request(t, router, http.MethodGet, "/api/v1/auth/me", nil)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("expected authenticated false, got %v", body["authenticated"])
	}
	providers, _ := body["providers"].([]any)
	if len(providers) != 1 || providers[0] != "github" {
		t.Fatalf("expected [github], got %v", body["providers"])
	}
}

func TestAuthMeWithVisitorSession(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {
		*cfg = *enabledConfig()
	})
	identity, err := database.UpsertIdentity("github", "1001", "Octo Cat", "https://avatars.example/u/1001", "octo@example.com")
	if err != nil {
		t.Fatal(err)
	}
	authService, err := auth.New(*enabledConfig(), database)
	if err != nil {
		t.Fatal(err)
	}
	token, err := authService.SignVisitor(identity.ID, identity.Provider, identity.DisplayName, identity.AvatarURL, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	response := requestWithAuth(t, router, http.MethodGet, "/api/v1/auth/me", nil, token)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != true || body["displayName"] != "Octo Cat" || body["provider"] != "github" {
		t.Fatalf("unexpected me body: %v", body)
	}
}

func TestGithubExchangeDisabled(t *testing.T) {
	router := newTestRouter(t)
	response := request(t, router, http.MethodPost, "/api/v1/auth/github/exchange", strings.NewReader(`{"code":"abc"}`))
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501 when unconfigured, got %d", response.Code)
	}
}

// TestCreateCommentWithVisitorSession verifies the session is authoritative:
// the GitHub display name and avatar replace the client-submitted identity.
func TestCreateCommentWithVisitorSession(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {
		*cfg = *enabledConfig()
	})
	slug := seededContentSlug(t, database)
	identity, err := database.UpsertIdentity("github", "2002", "Signed Reader", "https://avatars.example/u/2002", "")
	if err != nil {
		t.Fatal(err)
	}
	authService, err := auth.New(*enabledConfig(), database)
	if err != nil {
		t.Fatal(err)
	}
	token, err := authService.SignVisitor(identity.ID, identity.Provider, identity.DisplayName, identity.AvatarURL, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	body := `{"authorName":"spoofed","body":"A verified note","avatarSeed":"spoof-seed"}`
	response := requestWithAuth(t, router, http.MethodPost, "/api/v1/content/"+slug+"/comments", strings.NewReader(body), token)
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var comment map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &comment); err != nil {
		t.Fatal(err)
	}
	if comment["authorName"] != "Signed Reader" {
		t.Fatalf("expected session name, got %v", comment["authorName"])
	}
	if comment["authorProvider"] != "github" || comment["authorAvatarUrl"] != "https://avatars.example/u/2002" {
		t.Fatalf("unexpected identity snapshot: %v %v", comment["authorProvider"], comment["authorAvatarUrl"])
	}
	if comment["avatarSeed"] != "" {
		t.Fatalf("expected cleared avatar seed for provider identity, got %v", comment["avatarSeed"])
	}
}

// TestCreateCommentAnonymousUnaffected keeps the visitor path untouched: no
// Authorization header yields the anonymous identity and submitted name.
func TestCreateCommentAnonymousUnaffected(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(cfg *config.Config) {
		*cfg = *enabledConfig()
	})
	slug := seededContentSlug(t, database)
	body := `{"authorName":"Plain Reader","body":"A plain note"}`
	response := request(t, router, http.MethodPost, "/api/v1/content/"+slug+"/comments", strings.NewReader(body))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var comment map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &comment); err != nil {
		t.Fatal(err)
	}
	if comment["authorProvider"] != "visitor" || comment["authorName"] != "Plain Reader" {
		t.Fatalf("unexpected anonymous comment: %v %v", comment["authorProvider"], comment["authorName"])
	}
}

// seededContentSlug creates and publishes a dedicated test article so the
// comment endpoints have a target; the in-memory router DB carries no seed.
func seededContentSlug(t *testing.T, database *store.Store) string {
	t.Helper()
	title := "OAuth test article"
	content, err := database.CreateContent(model.ContentInput{Kind: model.ContentKindArticle, Slug: "oauth-test-article", Title: &title, Body: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetContentStatus(content.ID, model.StatusPublished); err != nil {
		t.Fatal(err)
	}
	return content.Slug
}

func requestWithAuth(t *testing.T, router http.Handler, method, path string, body io.Reader, token string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
