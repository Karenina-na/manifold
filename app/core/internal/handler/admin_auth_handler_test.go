package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

// errorCode extracts error.code from the single error envelope.
func errorCode(t *testing.T, body []byte) string {
	t.Helper()
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode error body: %v (%s)", err, body)
	}
	return envelope.Error.Code
}

// A credential-store failure during login is not a wrong password. Mapping it
// to 401 INVALID_CREDENTIALS told the operator to go look at the password while
// Core was actually unable to reach its own database, and it also wrote a
// spurious admin.session.failed row into the audit trail.
func TestLoginReportsACredentialStoreFailureAsAServerError(t *testing.T) {
	router, database := newTestRouterWithConfig(t, func(*config.Config) {})
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	recorder := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"password"}`))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when the credential store is unreachable, got %d %s", recorder.Code, recorder.Body.String())
	}
	if code := errorCode(t, recorder.Body.Bytes()); code != "SESSION_UNAVAILABLE" {
		t.Fatalf("expected SESSION_UNAVAILABLE, got %q", code)
	}
}

// The wrong-password path must keep answering 401 INVALID_CREDENTIALS: this is
// the negative control for the test above, and it pins the public contract that
// the store-error split must not move.
func TestLoginStillReportsAWrongPasswordAsUnauthorized(t *testing.T) {
	router, _ := newTestRouterWithConfig(t, func(*config.Config) {})

	recorder := request(t, router, http.MethodPost, "/api/v1/admin/session", strings.NewReader(`{"username":"admin","password":"wrongpassword"}`))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a wrong password, got %d %s", recorder.Code, recorder.Body.String())
	}
	if code := errorCode(t, recorder.Body.Bytes()); code != "INVALID_CREDENTIALS" {
		t.Fatalf("expected INVALID_CREDENTIALS, got %q", code)
	}
}
