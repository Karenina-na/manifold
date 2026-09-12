package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// oversizedJSON builds a body that is valid JSON and over the shared 1 MiB cap.
func oversizedJSON(prefix, suffix string) string {
	return prefix + strings.Repeat("x", 1<<20) + suffix
}

// The body cap lives in the single decode boundary, so every JSON endpoint
// answers it with the same 413 the media-upload and anchor-submission ceilings
// already use — rather than buffering the body in full and reporting it as a
// validation error.
func TestJSONBodyOverTheCapIsRejectedWith413(t *testing.T) {
	router := newTestRouter(t)

	response := request(t, router, http.MethodPost, "/api/v1/admin/session",
		strings.NewReader(oversizedJSON(`{"username":"admin","password":"`, `"}`)))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for a body over the cap, got %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "PAYLOAD_TOO_LARGE" {
		t.Fatalf("expected PAYLOAD_TOO_LARGE, got %q", body.Error.Code)
	}
}

// An endpoint whose own failures are 422 must still answer 413 for an oversized
// body: the size refusal happens before any handler-level validation.
func TestJSONBodyOverTheCapOverridesTheEndpointValidationStatus(t *testing.T) {
	router := newTestRouter(t)
	token := adminToken(t, router)

	response := adminRequest(t, router, token, http.MethodPut, "/api/v1/admin/profile",
		oversizedJSON(`{"displayName":"admin","bio":"`, `"}`))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d %s", response.Code, response.Body.String())
	}
}

// The cap must not get in the way of an ordinary request.
func TestJSONBodyUnderTheCapStillReachesTheHandler(t *testing.T) {
	router := newTestRouter(t)

	response := request(t, router, http.MethodPost, "/api/v1/admin/session",
		strings.NewReader(`{"username":"admin","password":"password"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
	}
}
