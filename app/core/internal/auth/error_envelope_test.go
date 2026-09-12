package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The auth package used to carry its own copy of the error envelope, identical
// to handler.WriteError but unable to share it because handler imports auth.
// Both now call apierror.WriteError. This pins the wire shape that move had to
// preserve, including the two correlation ids the middleware publishes as
// response headers before the middleware runs.
func TestRequireAdminWritesTheSharedErrorEnvelope(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	recorder := httptest.NewRecorder()
	recorder.Header().Set("X-Request-ID", "req_1")
	recorder.Header().Set("X-Trace-ID", "trace_1")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/site", nil)
	service.RequireAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("an unauthenticated request must not reach the wrapped handler")
	})).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	var body struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
			TraceID   string `json:"traceId"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("the error body is not JSON: %v (%s)", err, recorder.Body.String())
	}
	if body.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("code = %q, want UNAUTHORIZED", body.Error.Code)
	}
	if body.Error.Message == "" {
		t.Fatal("the error body must carry a message")
	}
	if body.Error.RequestID != "req_1" || body.Error.TraceID != "trace_1" {
		t.Fatalf("correlation ids were not forwarded: %+v", body.Error)
	}
}

// An error body must not invent correlation ids when the middleware did not set
// them; the fields are omitted rather than serialized empty.
func TestErrorEnvelopeOmitsAbsentCorrelationIDs(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/site", nil)
	service.RequireAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(recorder, request)
	var body map[string]map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, present := body["error"]["requestId"]; present {
		t.Fatalf("requestId must be omitted when unset, got %v", body["error"])
	}
	if _, present := body["error"]["traceId"]; present {
		t.Fatalf("traceId must be omitted when unset, got %v", body["error"])
	}
}
