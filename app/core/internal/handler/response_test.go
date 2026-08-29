package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	Health(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if got := recorder.Body.String(); got != "{\"status\":\"ok\",\"version\":\"0.1.0\"}\n" {
		t.Fatalf("unexpected response: %s", got)
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
