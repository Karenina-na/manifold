package handler

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

// anchorView is the HTTP wire shape of chain.Anchor (mirrors ChainAnchor in
// packages/contracts): BlockID maps to status/blockId.
type anchorView struct {
	ID            string            `json:"id"`
	SubjectHash   string            `json:"subjectHash"`
	Source        string            `json:"source"`
	SubjectRef    string            `json:"subjectRef"`
	Label         string            `json:"label"`
	Metadata      map[string]any    `json:"metadata"`
	SiteKeyID     string            `json:"siteKeyId"`
	SitePublicKey string            `json:"sitePublicKey"`
	SiteSignature string            `json:"siteSignature"`
	CreatedAt     string            `json:"createdAt"`
	Status        string            `json:"status"`
	BlockID       *string           `json:"blockId"`
}

func toAnchorView(anchor chain.Anchor) anchorView {
	view := anchorView{
		ID: anchor.ID, SubjectHash: anchor.SubjectHash, Source: anchor.Source,
		SubjectRef: anchor.SubjectRef, Label: anchor.Label, Metadata: anchor.Metadata,
		SiteKeyID: anchor.SiteKeyID, SitePublicKey: anchor.SitePublicKey,
		SiteSignature: anchor.SiteSignature, CreatedAt: anchor.CreatedAt,
	}
	if anchor.Metadata == nil {
		view.Metadata = map[string]any{}
	}
	if anchor.BlockID == "" {
		view.Status = "pending"
	} else {
		view.Status = "anchored"
		view.BlockID = &anchor.BlockID
	}
	return view
}

type blockSummaryView struct {
	ID          string `json:"id"`
	Index       int    `json:"index"`
	PrevHash    string `json:"prevHash"`
	Timestamp   string `json:"timestamp"`
	CertRoot    string `json:"certRoot"`
	Nonce       int    `json:"nonce"`
	ProofMode   string `json:"proofMode"`
	Difficulty  int    `json:"difficulty"`
	Hash        string `json:"hash"`
	AnchorCount int    `json:"anchorCount"`
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
	WriteJSON(w, http.StatusOK, collection(views, paginationFor(options.Page, options.PageSize, total)))
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
	WriteJSON(w, http.StatusOK, toAnchorView(anchor))
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
		"anchorCount": len(block.CertIDs), "anchors": anchorViews,
	})
}

// verifyResult assembles VerifyResponse from a subject hash lookup plus the
// full-chain replay (docs/chain.md §10). signatureValid/chainIntegrity always
// report the chain state even when the hash is unknown.
func (h *apiHandler) verifyResult(ledger *chain.Ledger, subjectHash string) (map[string]any, int) {
	report, err := ledger.ReplayVerify()
	if err != nil {
		return map[string]any{"error": map[string]any{"code": "CHAIN_UNAVAILABLE", "message": "Chain verification failed."}}, http.StatusInternalServerError
	}
	anchor, err := ledger.LatestAnchorByHash(subjectHash)
	var anchorPayload any
	var blockPayload any
	if err == nil {
		anchorPayload = toAnchorView(anchor)
		if anchor.BlockID != "" {
			if block, _, blockErr := ledger.GetBlock(anchor.BlockID); blockErr == nil {
				blockPayload = blockSummaryView{
					ID: block.ID, Index: block.Index, PrevHash: block.PrevHash, Timestamp: block.Timestamp,
					CertRoot: block.CertRoot, Nonce: block.Nonce, ProofMode: string(block.ProofMode),
					Difficulty: block.Difficulty, Hash: block.Hash, AnchorCount: len(block.CertIDs),
				}
			}
		}
	}
	found := err == nil
	signatureValid := false
	if found {
		signatureValid = chain.VerifySubjectHash(anchor.SitePublicKey, anchor.SubjectHash, anchor.SiteSignature)
	}
	return map[string]any{
		"found": found, "anchor": anchorPayload, "block": blockPayload,
		"signatureValid": signatureValid, "chainIntegrity": report.Intact,
	}, http.StatusOK
}

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
	payload, _, _, _, err := ContentPayload(content)
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
	payload, _, _, _, err := CommentPayload(comment.Comment, "created")
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

func validSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(strings.ToLower(value))
	return err == nil
}

func parsePageParams(r *http.Request, page, pageSize *int) error {
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return errors.New("page must be a positive integer")
		}
		*page = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("pageSize")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return errors.New("pageSize must be a positive integer")
		}
		if value > 100 {
			value = 100
		}
		*pageSize = value
	}
	return nil
}

func paginationFor(page, pageSize, total int) model.Pagination {
	totalPages := 0
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return model.Pagination{Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}
}
