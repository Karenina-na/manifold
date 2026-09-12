package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// profileBody renders a complete, admissible profile payload with the given
// override applied, so every rejection case below differs from an accepted
// baseline in exactly one way.
func profileBody(t *testing.T, override func(map[string]any)) string {
	t.Helper()
	body := map[string]any{
		"displayName":  "Garden",
		"handle":       "@garden",
		"headline":     "Systems and research",
		"bio":          "Notes on small tools.",
		"avatarUrl":    "https://cdn.example/avatar.png",
		"location":     "Peking",
		"organization": "Independent",
		"websiteUrl":   "https://example.com",
		"resumeUrl":    "https://cdn.example/resume.pdf",
		"interests":    []any{"systems", "research"},
		"education": []any{map[string]any{
			"institution": "Manifold", "program": "Research", "period": "Now",
		}},
		"experience": []any{map[string]any{
			"organization": "OpenList", "role": "Engineer", "period": "Ongoing",
		}},
		"series": []any{map[string]any{
			"name": "Relay", "url": "https://relay.example", "description": "A public relay", "category": "Infrastructure",
		}},
		"contacts": []any{map[string]any{
			"label": "Email", "url": "mailto:hello@example.com", "handle": "hello@example.com", "icon": "mail",
		}},
	}
	if override != nil {
		override(body)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func putProfile(t *testing.T, router http.Handler, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	return adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/profile", body)
}

// TestAdminProfileValidationRejectsOutOfContractInput is the regression guard
// for the review's M1 finding: the length and URL-scheme rules used to exist
// only in the Admin form's zod schema, so any other caller — a script, curl, a
// future third client — could persist an unbounded bio or a javascript: URL
// that the public site renders straight into an href.
func TestAdminProfileValidationRejectsOutOfContractInput(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	// The baseline must be accepted, otherwise every rejection below could be
	// passing for a reason unrelated to the field under test.
	if baseline := putProfile(t, router, token, profileBody(t, nil)); baseline.Code != http.StatusOK {
		t.Fatalf("expected the baseline profile to be accepted, got %d %s", baseline.Code, baseline.Body.String())
	}

	cases := []struct {
		name     string
		override func(map[string]any)
	}{
		{"displayName over the limit", func(b map[string]any) { b["displayName"] = strings.Repeat("x", 161) }},
		{"handle over the limit", func(b map[string]any) { b["handle"] = strings.Repeat("x", 81) }},
		{"headline over the limit", func(b map[string]any) { b["headline"] = strings.Repeat("x", 241) }},
		{"bio over the limit", func(b map[string]any) { b["bio"] = strings.Repeat("x", 4001) }},
		{"location over the limit", func(b map[string]any) { b["location"] = strings.Repeat("x", 161) }},
		{"organization over the limit", func(b map[string]any) { b["organization"] = strings.Repeat("x", 161) }},
		{"javascript avatarUrl", func(b map[string]any) { b["avatarUrl"] = "javascript:alert(1)" }},
		{"data avatarUrl", func(b map[string]any) { b["avatarUrl"] = "data:image/svg+xml,<svg onload=alert(1)>" }},
		{"scheme-less websiteUrl", func(b map[string]any) { b["websiteUrl"] = "example.com" }},
		{"javascript resumeUrl", func(b map[string]any) { b["resumeUrl"] = "javascript:alert(1)" }},
		{"avatarUrl over the limit", func(b map[string]any) { b["avatarUrl"] = "https://cdn.example/" + strings.Repeat("x", 500) }},
		{"blank interest", func(b map[string]any) { b["interests"] = []any{"systems", "   "} }},
		{"interest over the limit", func(b map[string]any) { b["interests"] = []any{strings.Repeat("x", 61)} }},
		{"blank institution", func(b map[string]any) {
			b["education"] = []any{map[string]any{"institution": "  ", "program": "Research", "period": "Now"}}
		}},
		{"blank education period", func(b map[string]any) {
			b["education"] = []any{map[string]any{"institution": "Manifold", "program": "Research", "period": ""}}
		}},
		{"blank experience role", func(b map[string]any) {
			b["experience"] = []any{map[string]any{"organization": "OpenList", "role": "", "period": "Ongoing"}}
		}},
		{"blank series name", func(b map[string]any) {
			b["series"] = []any{map[string]any{"name": "", "url": "https://relay.example", "description": "", "category": nil}}
		}},
		{"series url with an unlisted scheme", func(b map[string]any) {
			b["series"] = []any{map[string]any{"name": "Relay", "url": "ftp://relay.example", "description": "", "category": nil}}
		}},
		{"series url missing", func(b map[string]any) {
			b["series"] = []any{map[string]any{"name": "Relay", "url": "", "description": "", "category": nil}}
		}},
		{"series description over the limit", func(b map[string]any) {
			b["series"] = []any{map[string]any{"name": "Relay", "url": "https://relay.example", "description": strings.Repeat("x", 401), "category": nil}}
		}},
		{"series category over the limit", func(b map[string]any) {
			b["series"] = []any{map[string]any{"name": "Relay", "url": "https://relay.example", "description": "", "category": strings.Repeat("x", 81)}}
		}},
		{"blank contact label", func(b map[string]any) {
			b["contacts"] = []any{map[string]any{"label": "", "url": "https://wa.me/123", "handle": nil, "icon": nil}}
		}},
		{"javascript contact url", func(b map[string]any) {
			b["contacts"] = []any{map[string]any{"label": "Chat", "url": "javascript:alert(1)", "handle": nil, "icon": nil}}
		}},
		{"contact icon over the limit", func(b map[string]any) {
			b["contacts"] = []any{map[string]any{"label": "Chat", "url": "https://wa.me/123", "handle": nil, "icon": strings.Repeat("x", 41)}}
		}},
		{"contact handle over the limit", func(b map[string]any) {
			b["contacts"] = []any{map[string]any{"label": "Chat", "url": "https://wa.me/123", "handle": strings.Repeat("x", 121), "icon": nil}}
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := putProfile(t, router, token, profileBody(t, testCase.override))
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected 422, got %d %s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"VALIDATION_ERROR"`) {
				t.Fatalf("expected VALIDATION_ERROR, got %s", response.Body.String())
			}
		})
	}

	// A rejected update must not have written anything: validation runs before
	// the mutation, and a partially applied profile would be worse than a 422.
	read := adminRequest(t, router, token, http.MethodGet, "/api/v1/admin/profile", "")
	if read.Code != http.StatusOK {
		t.Fatalf("expected profile read 200, got %d", read.Code)
	}
	var stored struct {
		DisplayName string   `json:"displayName"`
		Bio         string   `json:"bio"`
		AvatarURL   string   `json:"avatarUrl"`
		Interests   []string `json:"interests"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.DisplayName != "Garden" || stored.Bio != "Notes on small tools." || stored.AvatarURL != "https://cdn.example/avatar.png" {
		t.Fatalf("a rejected update changed the stored profile: %+v", stored)
	}
	if len(stored.Interests) != 2 || stored.Interests[0] != "systems" {
		t.Fatalf("a rejected update changed the stored interests: %+v", stored.Interests)
	}
}

// TestAdminProfileLengthsAreCountedInCharacters pins the unit. A byte cap would
// reject this bio at roughly a third of the documented limit, which would be a
// silent regression for CJK content.
func TestAdminProfileLengthsAreCountedInCharacters(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	response := putProfile(t, router, token, profileBody(t, func(b map[string]any) {
		b["bio"] = strings.Repeat("花", 4000)
		b["headline"] = strings.Repeat("界", 240)
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected a bio at the 4000-character limit to be accepted, got %d %s", response.Code, response.Body.String())
	}
}

// TestAdminProfileAcceptsOptionalFieldsEmpty keeps the new rules from turning
// the empty-but-required shape into a rejection: every scalar field except
// displayName is optional, and the Admin form sends empty strings for them.
func TestAdminProfileAcceptsOptionalFieldsEmpty(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	response := putProfile(t, router, token, profileBody(t, func(b map[string]any) {
		b["handle"] = ""
		b["headline"] = ""
		b["bio"] = ""
		b["avatarUrl"] = ""
		b["location"] = ""
		b["organization"] = ""
		b["websiteUrl"] = ""
		b["resumeUrl"] = nil
		b["interests"] = []any{}
		b["education"] = []any{}
		b["experience"] = []any{}
		b["series"] = []any{}
		b["contacts"] = []any{}
	}))
	if response.Code != http.StatusOK {
		t.Fatalf("expected an all-empty optional profile to be accepted, got %d %s", response.Code, response.Body.String())
	}
}
