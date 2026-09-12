package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/chain"
)

// enrichView is the single-anchor variant of enrichAnchorViews.
func (h *apiHandler) enrichView(ctx context.Context, view anchorView) anchorView {
	enriched := h.enrichAnchorViews(ctx, []anchorView{view})
	return enriched[0]
}

func (h *apiHandler) requireLedger(w http.ResponseWriter) (*chain.Ledger, bool) {
	if h.ledger == nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.ChainUnavailable, "The anchoring chain is not enabled.")
		return nil, false
	}
	return h.ledger, true
}

func (h *apiHandler) chainInfo(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	info, err := ledger.ChainInfo(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Chain info is unavailable.")
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
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	options := chain.AnchorListOptions{Page: 1, PageSize: 20}
	if raw := strings.TrimSpace(r.URL.Query().Get("source")); raw != "" {
		if !chain.ValidSource(raw) {
			WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "source is invalid")
			return
		}
		options.Source = raw
	}
	options.Ref = strings.TrimSpace(r.URL.Query().Get("ref"))
	if err := parsePageParams(r, &options.Page, &options.PageSize); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	anchors, total, err := ledger.ListAnchors(r.Context(), options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Anchors are unavailable.")
		return
	}
	views := make([]anchorView, 0, len(anchors))
	for _, anchor := range anchors {
		views = append(views, toAnchorView(anchor))
	}
	WriteJSON(w, http.StatusOK, collection(h.enrichAnchorViews(r.Context(), views), paginationFor(options.Page, options.PageSize, total)))
}

func (h *apiHandler) getChainAnchor(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	anchor, err := ledger.GetAnchor(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.AnchorNotFound, "Anchor was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Anchors are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, h.enrichView(r.Context(), toAnchorView(anchor)))
}

func (h *apiHandler) listChainBlocks(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	if err := rejectUnknownQuery(r.URL.Query(), "page", "pageSize"); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	page, pageSize := 1, 20
	if err := parsePageParams(r, &page, &pageSize); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	blocks, total, err := ledger.ListBlocks(r.Context(), page, pageSize)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Blocks are unavailable.")
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
	block, anchors, err := ledger.GetBlock(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.BlockNotFound, "Block was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Blocks are unavailable.")
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
		"anchorCount": len(block.CertIDs), "anchors": h.enrichAnchorViews(r.Context(), anchorViews),
	})
}

func (h *apiHandler) listChainKeys(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	keys, err := ledger.ListSiteKeys(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Site keys are unavailable.")
		return
	}
	views := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		views = append(views, map[string]any{"keyId": key.KeyID, "publicKey": key.PublicKey, "createdAt": key.CreatedAt})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"keys": views})
}
