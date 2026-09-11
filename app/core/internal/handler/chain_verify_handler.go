package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/store"
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

func (h *apiHandler) verifyAnchorPayload(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	var input submitAnchorInput
	if err := decodeJSON(r, &input); err != nil || input.Payload == "" {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payload is required.")
		return
	}
	body, status := h.verifyResult(ledger, chain.SubjectHashHex([]byte(input.Payload)))
	if status != http.StatusOK {
		if payload, cast := body["error"].(map[string]any); cast {
			WriteError(w, status, payload["code"].(string), payload["message"].(string))
			return
		}
	}
	WriteJSON(w, status, body)
}

// verifyAnchorContent rebuilds the canonical payload from the live row so the
// hash always matches the current published substance (docs/chain.md §6).
func (h *apiHandler) verifyAnchorContent(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	content, err := h.store.GetContentBySlug(chi.URLParam(r, "slug"), false)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	payload, _, _, _, err := application.ContentPayload(content)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Payload could not be rebuilt.")
		return
	}
	body, status := h.verifyResult(ledger, chain.SubjectHashHex(payload))
	if status != http.StatusOK {
		if response, cast := body["error"].(map[string]any); cast {
			WriteError(w, status, response["code"].(string), response["message"].(string))
			return
		}
	}
	WriteJSON(w, status, body)
}

// verifyAnchorComment rebuilds the canonical comment payload. Hidden or
// soft-deleted comments 404 for public-visibility parity; their historical
// commitments remain verifiable by hash from anyone holding the original
// text (docs/chain.md §10).
func (h *apiHandler) verifyAnchorComment(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	comment, err := h.store.GetCommentByID(chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	if comment.Hidden || comment.DeletedAt != nil {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	payloadHashes, err := application.CommentPayloadHashes(comment.Comment)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Payload could not be rebuilt.")
		return
	}
	body, status := h.verifyResult(ledger, payloadHashes[0])
	for _, payloadHash := range payloadHashes[1:] {
		if status != http.StatusNotFound {
			break
		}
		body, status = h.verifyResult(ledger, payloadHash)
	}
	if status != http.StatusOK {
		if response, cast := body["error"].(map[string]any); cast {
			WriteError(w, status, response["code"].(string), response["message"].(string))
			return
		}
	}
	WriteJSON(w, status, body)
}
