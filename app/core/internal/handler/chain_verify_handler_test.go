package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// verifyResult builds the error envelope this helper forwards, so today it is
// always well formed. The point of the test is the boundary: a malformed map
// must be refused, not asserted into a panic that would take the whole server
// down on a routine 4xx.
func TestWriteVerifyFailureRefusesAMalformedEnvelope(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"no error key":      {"detail": "nope"},
		"error not a map":   {"error": "nope"},
		"code missing":      {"error": map[string]any{"message": "nope"}},
		"code not a string": {"error": map[string]any{"code": 42, "message": "nope"}},
		"code empty":        {"error": map[string]any{"code": "", "message": "nope"}},
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if writeVerifyFailure(recorder, http.StatusNotFound, body) {
				t.Fatal("expected the malformed envelope to be refused")
			}
			if recorder.Body.Len() != 0 {
				t.Fatalf("expected no response body, got %q", recorder.Body.String())
			}
		})
	}
}

func TestWriteVerifyFailureForwardsTheEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()
	body := map[string]any{"error": map[string]any{"code": "ANCHOR_NOT_FOUND", "message": "No anchor matches that hash."}}
	if !writeVerifyFailure(recorder, http.StatusNotFound, body) {
		t.Fatal("expected the envelope to be forwarded")
	}
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "ANCHOR_NOT_FOUND" || payload.Error.Message != "No anchor matches that hash." {
		t.Fatalf("unexpected body %s", recorder.Body.String())
	}
}

// A request/trace id is not a credential, so an unavailable CSPRNG must not fail
// the request — but the fallback still has to be unique. The timestamp-only
// fallback collided for two requests in the same clock tick.
func TestCorrelationIDFallbackStaysUniqueWithoutTheCSPRNG(t *testing.T) {
	original := readRandom
	readRandom = func([]byte) (int, error) { return 0, errors.New("entropy unavailable") }
	t.Cleanup(func() { readRandom = original })

	seen := map[string]bool{}
	for index := 0; index < 64; index++ {
		id := newCorrelationID("trace")
		if id == "" || !correlationIDPattern.MatchString(id) {
			t.Fatalf("fallback id %q is not a usable correlation id", id)
		}
		if seen[id] {
			t.Fatalf("duplicate fallback id %q", id)
		}
		seen[id] = true
	}
	if !strings.HasPrefix(newCorrelationID("req"), "req_") {
		t.Fatal("expected the prefix to be preserved")
	}
}
