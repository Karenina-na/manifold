package handler

import (
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := correlationID(r.Header.Get("X-Request-ID"), "req")
		traceID := correlationID(r.Header.Get("X-Trace-ID"), "trace")
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		r.Header.Set("X-Request-ID", requestID)
		r.Header.Set("X-Trace-ID", traceID)
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		slog.Info("http_request", "requestId", requestID, "traceId", traceID, "method", r.Method, "path", r.URL.Path, "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.wroteHeader = true
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(body)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

var correlationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func correlationID(value, prefix string) string {
	value = strings.TrimSpace(value)
	if correlationIDPattern.MatchString(value) {
		return value
	}
	return newCorrelationID(prefix)
}

// readRandom is a seam so the CSPRNG failure path is testable. Production never
// reassigns it.
var readRandom = rand.Read

// correlationFallbackCounter keeps fallback ids unique. A bare timestamp did not:
// two requests inside the same clock tick shared an id, which silently corrupts
// trace correlation.
var correlationFallbackCounter atomic.Uint64

func newCorrelationID(prefix string) string {
	value := make([]byte, 8)
	if _, err := readRandom(value); err != nil {
		// Deliberately not fail-closed, unlike the session id in internal/auth.
		// This id is not a credential — it is echoed back in the response and
		// used for tracing — so a degraded CSPRNG must not fail the request.
		// The counter is what makes the fallback safe.
		return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), correlationFallbackCounter.Add(1))
	}
	return prefix + "_" + fmt.Sprintf("%x", value)
}
