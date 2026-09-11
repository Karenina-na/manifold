package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

// decodeJSON is the single JSON request boundary. Unknown fields and trailing
// payloads are rejected so the wire contract cannot silently drift.
func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	errorBody := map[string]any{"code": code, "message": message}
	if requestID := w.Header().Get("X-Request-ID"); requestID != "" {
		errorBody["requestId"] = requestID
	}
	if traceID := w.Header().Get("X-Trace-ID"); traceID != "" {
		errorBody["traceId"] = traceID
	}
	WriteJSON(w, status, map[string]any{"error": errorBody})
}

func Health(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": coreVersion, "startedAt": processStartedAt.Format(time.RFC3339)})
}

// collection is the single list envelope for every endpoint.
func collection[T any](items []T, pagination model.Pagination) map[string]any {
	if items == nil {
		items = []T{}
	}
	return map[string]any{"data": items, "pagination": pagination}
}
