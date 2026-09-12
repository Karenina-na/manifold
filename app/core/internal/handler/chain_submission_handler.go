package handler

import (
	"net/http"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/chain"
)

type submitAnchorInput struct {
	Payload string `json:"payload"`
	Label   string `json:"label"`
}

// decodeSubmitAnchor validates the shared visitor/admin submission body:
// payload is required, non-empty, within the configured byte ceiling, and
// the optional label fits 64 runes.
func (h *apiHandler) decodeSubmitAnchor(w http.ResponseWriter, r *http.Request) (submitAnchorInput, bool) {
	var input submitAnchorInput
	if err := decodeJSON(r, &input); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidJSON, "Request body is not valid JSON.")
		return input, false
	}
	if input.Payload == "" {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "payload is required.")
		return input, false
	}
	if label := []rune(input.Label); len(label) > 64 {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "label is too long.")
		return input, false
	}
	limit := h.cfg.ChainAnchorMaxBytes
	if limit <= 0 {
		limit = 1 << 16
	}
	if int64(len([]byte(input.Payload))) > limit {
		WriteError(w, http.StatusRequestEntityTooLarge, apierror.PayloadTooLarge, "Payload exceeds the configured size limit.")
		return input, false
	}
	return input, true
}

func (h *apiHandler) submitAnchor(w http.ResponseWriter, r *http.Request, source string) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	input, ok := h.decodeSubmitAnchor(w, r)
	if !ok {
		return
	}
	// Arbitrary payloads hash the exact UTF-8 bytes as submitted; nothing is
	// canonicalized or stored (docs/chain.md §3.4).
	anchor, err := ledger.Submit(source, []byte(input.Payload), input.Label, "", nil)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AnchorSubmitFailed, "The anchor could not be submitted.")
		return
	}
	h.audit(r, "chain.anchor.submitted", source, anchor.ID, nil)
	WriteJSON(w, http.StatusAccepted, map[string]any{
		"anchorId": anchor.ID, "subjectHash": anchor.SubjectHash, "status": "pending",
	})
}

func (h *apiHandler) submitPublicAnchor(w http.ResponseWriter, r *http.Request) {
	h.submitAnchor(w, r, chain.SourceVisitor)
}

func (h *apiHandler) adminSubmitAnchor(w http.ResponseWriter, r *http.Request) {
	h.submitAnchor(w, r, chain.SourceAdmin)
}
