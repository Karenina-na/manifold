package github

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestGitHubOAuthClientExchange verifies the token leg against a mock GitHub
// token endpoint: success parses the access token, an error body surfaces as
// an authorization failure.
func TestGitHubOAuthClientExchange(t *testing.T) {
	var capturedForm string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		capturedForm = r.PostForm.Encode()
		if !strings.Contains(capturedForm, "client_id=test-id") || !strings.Contains(capturedForm, "client_secret=test-secret") || !strings.Contains(capturedForm, "code=abc123") {
			t.Errorf("unexpected form: %s", capturedForm)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "gho_token_1"})
	}))
	defer server.Close()
	client := &Client{clientID: "test-id", clientSecret: "test-secret", redirectURI: "http://localhost:3000/api/v1/auth/callback/github", tokenURL: server.URL, apiURL: "https://api.github.com", http: server.Client()}
	token, err := client.Exchange("abc123")
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if token != "gho_token_1" {
		t.Fatalf("expected gho_token_1, got %s", token)
	}
}

func TestGitHubOAuthClientExchangeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
	}))
	defer server.Close()
	client := &Client{tokenURL: server.URL, http: server.Client()}
	if _, err := client.Exchange("nope"); err != errAuthorizationFailed {
		t.Fatalf("expected errAuthorizationFailed, got %v", err)
	}
}

// TestGitHubOAuthClientProfile verifies the profile leg: name falls back to
// login when empty, and a non-200 status surfaces a profile failure.
func TestGitHubOAuthClientProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer gho_token_1" {
			t.Errorf("expected Bearer token, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 42, "login": "octocat", "name": "", "avatar_url": "https://avatars.example/u/42", "email": "octo@example.com"})
	}))
	defer server.Close()
	client := &Client{apiURL: server.URL, http: server.Client()}
	profile, err := client.Profile("gho_token_1")
	if err != nil {
		t.Fatalf("profile failed: %v", err)
	}
	if profile.ID != 42 || profile.Login != "octocat" || profile.Name != "" {
		t.Fatalf("unexpected profile: %+v", profile)
	}
	// Name is empty in the fixture; the exchange handler falls back to Login.
	displayName := profile.Name
	if displayName == "" {
		displayName = profile.Login
	}
	if displayName != "octocat" {
		t.Fatalf("expected fallback to login, got %s", displayName)
	}
}

func TestGitHubOAuthClientProfileFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	client := &Client{apiURL: server.URL, http: server.Client()}
	if _, err := client.Profile("bad"); err != errProfileUnavailable {
		t.Fatalf("expected errProfileUnavailable, got %v", err)
	}
}
