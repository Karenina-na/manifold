package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
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
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	hash := strings.TrimSpace(r.URL.Query().Get("hash"))
	if hash == "" || !validSHA256Hex(hash) {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "hash must be a 64-character sha256 hex string.")
		return
	}
	body, status := h.verifyResult(r.Context(), ledger, strings.ToLower(hash))
	if status != http.StatusOK && writeVerifyFailure(w, status, body) {
		return
	}
	WriteJSON(w, status, body)
}

func (h *apiHandler) verifyAnchorPayload(w http.ResponseWriter, r *http.Request) {
	ledger, ok := h.requireLedger(w)
	if !ok {
		return
	}
	var input submitAnchorInput
	if err := decodeJSON(w, r, &input); err != nil || input.Payload == "" {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusBadRequest, apierror.ValidationError, "payload is required.")
		}
		return
	}
	body, status := h.verifyResult(r.Context(), ledger, chain.SubjectHashHex([]byte(input.Payload)))
	if status != http.StatusOK && writeVerifyFailure(w, status, body) {
		return
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
	content, err := h.store.GetContentBySlug(r.Context(), chi.URLParam(r, "slug"), false)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentUnavailable, "Content is unavailable.")
		return
	}
	payload, _, _, _, err := application.ContentPayload(content)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Payload could not be rebuilt.")
		return
	}
	body, status := h.verifyResult(r.Context(), ledger, chain.SubjectHashHex(payload))
	if status != http.StatusOK && writeVerifyFailure(w, status, body) {
		return
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
	comment, err := h.store.GetCommentByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.CommentNotFound, "Comment was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentsUnavailable, "Comments are unavailable.")
		return
	}
	if comment.Hidden || comment.DeletedAt != nil {
		WriteError(w, http.StatusNotFound, apierror.CommentNotFound, "Comment was not found.")
		return
	}
	payloadHashes, err := application.CommentPayloadHashes(comment.Comment)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ChainUnavailable, "Payload could not be rebuilt.")
		return
	}
	body, status := h.verifyResult(r.Context(), ledger, payloadHashes[0])
	for _, payloadHash := range payloadHashes[1:] {
		if status != http.StatusNotFound {
			break
		}
		body, status = h.verifyResult(r.Context(), ledger, payloadHash)
	}
	if status != http.StatusOK && writeVerifyFailure(w, status, body) {
		return
	}
	WriteJSON(w, status, body)
}

// writeVerifyFailure forwards the error envelope verifyResult puts in the body
// when the lookup or replay failed, and reports whether it wrote a response.
//
// Today the only non-OK status verifyResult produces is a 500 carrying
// apierror.ChainUnavailable, so the unchecked `payload["code"].(string)` this
// replaced could not panic. It still asserted a shape no one had promised: any
// future change that returns a differently shaped body would turn a routine
// failure response into a panic for the whole process. When the envelope does
// not match, this reports false and the caller falls back to writing the body
// as-is rather than dropping the response.
func writeVerifyFailure(w http.ResponseWriter, status int, body map[string]any) bool {
	payload, ok := body["error"].(map[string]any)
	if !ok {
		return false
	}
	code, ok := payload["code"].(string)
	if !ok || code == "" {
		return false
	}
	message, _ := payload["message"].(string)
	WriteError(w, status, code, message)
	return true
}

// verifyResult assembles VerifyResponse from a subject hash lookup plus the
// full-chain replay (docs/chain.md §10). signatureValid/chainIntegrity always
// report the chain state even when the hash is unknown. The response also
// carries the step-by-step process (steps/merkle/context) so the explorer can
// render how the verification was computed, not just its verdict.
func (h *apiHandler) verifyResult(ctx context.Context, ledger *chain.Ledger, subjectHash string) (map[string]any, int) {
	report, err := ledger.ReplayVerify(ctx)
	if err != nil {
		return map[string]any{"error": map[string]any{"code": apierror.ChainUnavailable, "message": "Chain verification failed."}}, http.StatusInternalServerError
	}
	anchor, err := ledger.LatestAnchorByHash(ctx, subjectHash)
	steps := []verifyStepView{
		{ID: "lookup", Label: "Certificate lookup", Status: "failed", Detail: "No certificate found for this subject hash."},
		{ID: "signature", Label: "Site signature", Status: "failed", Detail: "Not evaluated — no certificate."},
		{ID: "merkle", Label: "Merkle root", Status: "failed", Detail: "Not evaluated — no certificate."},
		{ID: "block-hash", Label: "Block hash", Status: "failed", Detail: "Not evaluated — no certificate."},
	}
	var anchorPayload any
	var blockPayload any
	var merklePayload *merkleProofView
	var contextPayload *verifyChainContextView
	if err == nil {
		anchorPayload = h.enrichView(ctx, toAnchorView(anchor))
		lookupInputs := []verifyStepInputView{
			{Name: "subjectHash", Value: subjectHash},
			{Name: "certificate", Value: anchor.ID},
		}
		lookupOutput := "found ✓"
		if anchor.BlockID != "" {
			lookupInputs = append(lookupInputs, verifyStepInputView{Name: "block", Value: anchor.BlockID})
			lookupOutput = "cert sealed in " + anchor.BlockID + " ✓"
		}
		steps[0] = verifyStepView{ID: "lookup", Label: "Certificate lookup", Status: "passed",
			Detail: shortID(anchor.ID) + " → " + shortID(anchor.BlockID),
			Inputs: lookupInputs, Output: lookupOutput}
		signatureOK := chain.VerifySubjectHash(anchor.SitePublicKey, anchor.SubjectHash, anchor.SiteSignature)
		if signatureOK {
			steps[1] = verifyStepView{ID: "signature", Label: "Site signature", Status: "passed",
				Detail: "ed25519 verify",
				Inputs: []verifyStepInputView{
					{Name: "algorithm", Value: "ed25519"},
					{Name: "publicKey", Value: anchor.SitePublicKey},
					{Name: "message", Value: "sha256(subject) → " + anchor.SubjectHash},
					{Name: "signature", Value: anchor.SiteSignature},
				},
				Output: "valid ✓"}
		} else {
			steps[1] = verifyStepView{ID: "signature", Label: "Site signature", Status: "failed",
				Detail: "ed25519 verify",
				Inputs: []verifyStepInputView{
					{Name: "publicKey", Value: anchor.SitePublicKey},
					{Name: "message", Value: "sha256(subject) → " + anchor.SubjectHash},
					{Name: "signature", Value: anchor.SiteSignature},
				},
				Output: "invalid ✗"}
		}
		if anchor.BlockID != "" {
			if block, _, blockErr := ledger.GetBlock(ctx, anchor.BlockID); blockErr == nil {
				blockPayload = blockSummaryOf(block)
				contextPayload = h.blockChainContext(ctx, ledger, block)
				merklePayload = merkleProof(block.CertIDs, anchor.ID, block.CertRoot)
				header := chain.BlockHeader{Index: block.Index, PrevHash: block.PrevHash, Timestamp: block.Timestamp,
					CertRoot: block.CertRoot, ProofMode: block.ProofMode, Difficulty: block.Difficulty, Nonce: block.Nonce}
				recomputed := header.Hash()
				preimage := strconv.Itoa(block.Index) + "|" + block.PrevHash + "|" + block.Timestamp + "|" + block.CertRoot + "|" + string(block.ProofMode) + "|" + strconv.Itoa(block.Difficulty) + "|" + strconv.Itoa(block.Nonce)
				if recomputed == block.Hash {
					steps[3] = verifyStepView{ID: "block-hash", Label: "Block hash", Status: "passed",
						Detail: "sha256(preimage) == stored",
						Inputs: []verifyStepInputView{
							{Name: "index", Value: strconv.Itoa(block.Index)},
							{Name: "prevHash", Value: block.PrevHash},
							{Name: "timestamp", Value: block.Timestamp},
							{Name: "certRoot", Value: block.CertRoot},
							{Name: "proofMode", Value: string(block.ProofMode)},
							{Name: "difficulty", Value: strconv.Itoa(block.Difficulty)},
							{Name: "nonce", Value: strconv.Itoa(block.Nonce)},
						},
						Computations: []verifyStepComputationView{{Expression: "sha256(\"" + preimage + "\")", Value: recomputed}},
						Output:       "recomputed == stored ✓"}
				} else {
					steps[3] = verifyStepView{ID: "block-hash", Label: "Block hash", Status: "failed",
						Detail: "sha256(preimage) != stored",
						Inputs: []verifyStepInputView{
							{Name: "preimage", Value: preimage},
						},
						Computations: []verifyStepComputationView{{Expression: "sha256(preimage)", Value: recomputed}},
						Output:       "recomputed != stored ✗"}
				}
				if merklePayload != nil && merklePayload.Matches {
					steps[2] = verifyStepView{ID: "merkle", Label: "Merkle root", Status: "passed",
						Detail: "leaf + " + strconv.Itoa(len(merklePayload.Siblings)) + " sibling(s) → root",
						Inputs: []verifyStepInputView{
							{Name: "certIds", Value: strconv.Itoa(len(block.CertIDs)) + " in " + block.ID},
							{Name: "leafIndex", Value: strconv.Itoa(merklePayload.LeafIndex)},
							{Name: "leaf", Value: merklePayload.Leaf},
						},
						Computations: merklePayload.Computations,
						Output:       "root == certRoot ✓"}
				} else {
					steps[2] = verifyStepView{ID: "merkle", Label: "Merkle root", Status: "failed", Detail: "root != certRoot",
						Output: "root mismatch ✗"}
				}
			}
		}
	}
	chainStatus := "passed"
	chainDetail := strconv.Itoa(report.Height) + " blocks replayed"
	if !report.Intact {
		chainStatus = "failed"
		chainDetail = strconv.Itoa(len(report.Problems)) + " problem(s)"
	}
	steps = append(steps, verifyStepView{ID: "chain", Label: "Chain replay", Status: chainStatus, Detail: chainDetail,
		Inputs: []verifyStepInputView{
			{Name: "height", Value: strconv.Itoa(report.Height)},
			{Name: "indexChecks", Value: strconv.Itoa(report.IndexChecks)},
			{Name: "prevLinks", Value: strconv.Itoa(report.PrevLinks)},
			{Name: "merkleRoots", Value: strconv.Itoa(report.MerkleRoots)},
			{Name: "signatures", Value: strconv.Itoa(report.Signatures)},
		},
		Output: map[bool]string{true: "intact ✓", false: "tampered ✗"}[report.Intact]})
	return map[string]any{
		"found": err == nil, "anchor": anchorPayload, "block": blockPayload,
		"signatureValid": len(steps) > 1 && steps[1].Status == "passed", "chainIntegrity": report.Intact,
		"steps": steps, "merkle": merklePayload, "context": contextPayload,
	}, http.StatusOK
}

// blockChainContext resolves the block before/after a verified certificate so
// the explorer can render the local chain structure around it.
func (h *apiHandler) blockChainContext(ctx context.Context, ledger *chain.Ledger, block chain.Block) *verifyChainContextView {
	view := &verifyChainContextView{Current: blockSummaryOf(block)}
	if block.Index > 0 {
		if prev, err := ledger.BlockByIndex(ctx, block.Index-1); err == nil {
			view.Prev = blockSummaryOf(prev)
		}
	}
	if next, err := ledger.BlockByIndex(ctx, block.Index+1); err == nil {
		view.Next = blockSummaryOf(next)
	}
	return view
}
