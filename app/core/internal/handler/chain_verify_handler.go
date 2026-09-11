package handler

import (
	"net/http"
	"strings"
)

func (h *apiHandler) verifyAnchorByHash(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	if err := rejectUnknownQuery(r.URL.Query(), "hash"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	hash := strings.TrimSpace(r.URL.Query().Get("hash"))
	if hash == "" || !validSHA256Hex(hash) {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "hash must be a 64-character sha256 hex string.")
		return
	}
	body, status := h.verifyResult(ledger, strings.ToLower(hash))
	if status != http.StatusOK {
		if payload, cast := body["error"].(map[string]any); cast {
			WriteError(w, status, payload["code"].(string), payload["message"].(string))
			return
		}
	}
	WriteJSON(w, status, body)
}
