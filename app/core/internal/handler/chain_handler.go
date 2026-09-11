package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/chain"
)

// enrichView is the single-anchor variant of enrichAnchorViews.
func (h *apiHandler) enrichView(view anchorView) anchorView {
	enriched := h.enrichAnchorViews([]anchorView{view})
	return enriched[0]
}

func (h *apiHandler) requireLedger(w http.ResponseWriter) (*chain.Ledger, bool) {
	if h.ledger == nil {
		WriteError(w, http.StatusServiceUnavailable, "CHAIN_UNAVAILABLE", "The anchoring chain is not enabled.")
		return nil, false
	}
	return h.ledger, true
}

func (h *apiHandler) chainInfo(w http.ResponseWriter, _ *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	info, err := ledger.ChainInfo()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Chain info is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"height": info.Height, "totalAnchors": info.TotalAnchors, "pendingAnchors": info.PendingAnchors,
		"proofMode": string(info.ProofMode), "difficulty": info.Difficulty,
		"genesisHash": info.GenesisHash, "tipHash": info.TipHash, "sitePublicKey": info.SitePublicKey,
	})
}

func (h *apiHandler) listChainAnchors(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	if err := rejectUnknownQuery(r.URL.Query(), "source", "ref", "page", "pageSize"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	options := chain.AnchorListOptions{Page: 1, PageSize: 20}
	if raw := strings.TrimSpace(r.URL.Query().Get("source")); raw != "" {
		if !chain.ValidSource(raw) {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "source is invalid")
			return
		}
		options.Source = raw
	}
	options.Ref = strings.TrimSpace(r.URL.Query().Get("ref"))
	if err := parsePageParams(r, &options.Page, &options.PageSize); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	anchors, total, err := ledger.ListAnchors(options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Anchors are unavailable.")
		return
	}
	views := make([]anchorView, 0, len(anchors))
	for _, anchor := range anchors {
		views = append(views, toAnchorView(anchor))
	}
	WriteJSON(w, http.StatusOK, collection(h.enrichAnchorViews(views), paginationFor(options.Page, options.PageSize, total)))
}

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
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Request body is not valid JSON.")
		return input, false
	}
	if input.Payload == "" {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "payload is required.")
		return input, false
	}
	if label := []rune(input.Label); len(label) > 64 {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "label is too long.")
		return input, false
	}
	limit := h.cfg.ChainAnchorMaxBytes
	if limit <= 0 {
		limit = 1 << 16
	}
	if int64(len([]byte(input.Payload))) > limit {
		WriteError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Payload exceeds the configured size limit.")
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
		WriteError(w, http.StatusInternalServerError, "ANCHOR_SUBMIT_FAILED", "The anchor could not be submitted.")
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

func (h *apiHandler) getChainAnchor(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	anchor, err := ledger.GetAnchor(chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "ANCHOR_NOT_FOUND", "Anchor was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Anchors are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, h.enrichView(toAnchorView(anchor)))
}

func (h *apiHandler) listChainBlocks(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	if err := rejectUnknownQuery(r.URL.Query(), "page", "pageSize"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	page, pageSize := 1, 20
	if err := parsePageParams(r, &page, &pageSize); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	blocks, total, err := ledger.ListBlocks(page, pageSize)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Blocks are unavailable.")
		return
	}
	views := make([]blockSummaryView, 0, len(blocks))
	for _, block := range blocks {
		views = append(views, blockSummaryView{
			ID: block.ID, Index: block.Index, PrevHash: block.PrevHash, Timestamp: block.Timestamp,
			CertRoot: block.CertRoot, Nonce: block.Nonce, ProofMode: string(block.ProofMode),
			Difficulty: block.Difficulty, Hash: block.Hash, AnchorCount: len(block.CertIDs),
		})
	}
	WriteJSON(w, http.StatusOK, collection(views, paginationFor(page, pageSize, total)))
}

func (h *apiHandler) getChainBlock(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	block, anchors, err := ledger.GetBlock(chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "BLOCK_NOT_FOUND", "Block was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Blocks are unavailable.")
		return
	}
	anchorViews := make([]anchorView, 0, len(anchors))
	for _, anchor := range anchors {
		anchorViews = append(anchorViews, toAnchorView(anchor))
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"id": block.ID, "index": block.Index, "prevHash": block.PrevHash, "timestamp": block.Timestamp,
		"certRoot": block.CertRoot, "certIds": block.CertIDs, "nonce": block.Nonce,
		"proofMode": string(block.ProofMode), "difficulty": block.Difficulty, "hash": block.Hash,
		"anchorCount": len(block.CertIDs), "anchors": h.enrichAnchorViews(anchorViews),
	})
}

func (h *apiHandler) listChainKeys(w http.ResponseWriter, _ *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	keys, err := ledger.ListSiteKeys()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CHAIN_UNAVAILABLE", "Site keys are unavailable.")
		return
	}
	views := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		views = append(views, map[string]any{"keyId": key.KeyID, "publicKey": key.PublicKey, "createdAt": key.CreatedAt})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"keys": views})
}
