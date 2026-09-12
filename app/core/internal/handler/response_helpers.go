package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

// maxJSONBodyBytes caps every JSON request body. The control-plane endpoints all
// carry small documents — the largest legitimate payload is an article body,
// itself bounded at 100k characters — so a mebibyte leaves an order of
// magnitude of headroom while stopping an unbounded body from being buffered.
const maxJSONBodyBytes = 1 << 20

// errBodyTooLarge is returned by decodeJSON after it has already answered the
// request with 413 PAYLOAD_TOO_LARGE. Callers must stop without writing a
// second response body, which is why they check it with errors.Is instead of
// treating every decode error alike.
var errBodyTooLarge = errors.New("request body exceeds the JSON size limit")

// decodeJSON is the single JSON request boundary. Unknown fields and trailing
// payloads are rejected so the wire contract cannot silently drift, and the
// body is wrapped in a MaxBytesReader so no endpoint can be made to buffer an
// unbounded request. The oversized case is answered here — once, with the same
// status and code the media-upload and anchor-submission ceilings already use —
// so call sites cannot each invent a different response for it.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return decodeJSONError(w, err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return decodeJSONError(w, err)
	}
	return nil
}

// decodeJSONError passes a decode failure through untouched unless it is the
// size cap: that one is answered here and reported as errBodyTooLarge so the
// caller skips its own response.
func decodeJSONError(w http.ResponseWriter, err error) error {
	var tooLarge *http.MaxBytesError
	if !errors.As(err, &tooLarge) {
		return err
	}
	WriteError(w, http.StatusRequestEntityTooLarge, apierror.PayloadTooLarge, "Request body exceeds the 1 MiB JSON limit.")
	return errBodyTooLarge
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
