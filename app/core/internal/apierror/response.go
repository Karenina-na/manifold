package apierror

import (
	"encoding/json"
	"net/http"
)

// WriteError is the single writer for the error envelope Core returns:
// {"error":{"code","message","requestId?","traceId?"}}.
//
// It lives in this package rather than in internal/handler because internal/auth
// needs it too, and handler imports auth — so a shared implementation in handler
// would be an import cycle. The two packages consequently carried a copy each,
// byte-identical and free to drift. Both now call this, and handler.WriteError
// remains as a one-line wrapper so the existing call sites are unchanged.
//
// The correlation ids are read from the response headers the request middleware
// has already set, so a caller does not have to thread them through.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	errorBody := map[string]any{"code": code, "message": message}
	if requestID := w.Header().Get("X-Request-ID"); requestID != "" {
		errorBody["requestId"] = requestID
	}
	if traceID := w.Header().Get("X-Trace-ID"); traceID != "" {
		errorBody["traceId"] = traceID
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": errorBody})
}
