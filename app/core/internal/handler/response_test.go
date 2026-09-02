package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientAddressTrustsForwardedIPOnlyFromConfiguredProxy(t *testing.T) {
	trusted := trustedProxyNetworks([]string{"127.0.0.1/32", "::1/128"})

	proxied := httptest.NewRequest(http.MethodGet, "/", nil)
	proxied.RemoteAddr = "127.0.0.1:43120"
	proxied.Header.Set("X-Real-IP", "198.51.100.42")
	if got := clientAddress(proxied, trusted); got != "198.51.100.42" {
		t.Fatalf("trusted proxy client address = %q", got)
	}

	direct := httptest.NewRequest(http.MethodGet, "/", nil)
	direct.RemoteAddr = "203.0.113.9:43120"
	direct.Header.Set("X-Real-IP", "198.51.100.42")
	if got := clientAddress(direct, trusted); got != "203.0.113.9" {
		t.Fatalf("untrusted client must not override address, got %q", got)
	}
}

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	Health(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var body struct {
		Status    string `json:"status"`
		Version   string `json:"version"`
		StartedAt string `json:"startedAt"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Version != coreVersion || body.StartedAt == "" {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
}

func TestStatusRecorderWritesHeadersOnce(t *testing.T) {
	var body bytes.Buffer
	recorder := &trackingResponseWriter{header: make(http.Header), body: &body}
	wrapped := &statusRecorder{ResponseWriter: recorder}

	wrapped.WriteHeader(http.StatusCreated)
	written, err := wrapped.Write([]byte("created"))
	if err != nil {
		t.Fatal(err)
	}
	if written != len("created") {
		t.Fatalf("expected %d bytes, got %d", len("created"), written)
	}
	if recorder.writeHeaders != 1 {
		t.Fatalf("expected one header write, got %d", recorder.writeHeaders)
	}
	if recorder.status != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", recorder.status)
	}
}

type trackingResponseWriter struct {
	header       http.Header
	body         *bytes.Buffer
	status       int
	writeHeaders int
}

func (w *trackingResponseWriter) Header() http.Header { return w.header }

func (w *trackingResponseWriter) WriteHeader(status int) {
	w.status = status
	w.writeHeaders++
}

func (w *trackingResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(body)
}
