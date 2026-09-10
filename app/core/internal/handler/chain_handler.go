package handler

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

// anchorView is the HTTP wire shape of chain.Anchor (mirrors ChainAnchor in
// packages/contracts): BlockID maps to status/blockId; Summary and Target are
// derived by the handler from live business rows so the explorer can say what
// a subject hash stands for and where it leads.
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
	Summary       string            `json:"summary"`
	Target        *anchorTargetView `json:"target"`
}

type anchorTargetView struct {
	Kind  string `json:"kind"`
	Href  string `json:"href"`
	Label string `json:"label"`
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

// enrichAnchorViews fills Summary/Target for every view. The chain package is
// deliberately payload-agnostic; the handler owns the business semantics here
// (docs/chain.md §2 boundary rule 1), reading only what a live row can answer.
func (h *apiHandler) enrichAnchorViews(views []anchorView) []anchorView {
	if len(views) == 0 {
		return views
	}
	commentIDs := make([]string, 0, len(views))
	contentIDs := make([]string, 0, len(views))
	for _, view := range views {
		if view.Source == chain.SourceComment && view.SubjectRef != "" {
			commentIDs = append(commentIDs, view.SubjectRef)
		}
		if id, ok := metadataString(view.Metadata, "contentId"); ok && (view.Source == chain.SourceReaction) {
			contentIDs = append(contentIDs, id)
		}
	}
	commentContent := map[string]string{}
	if len(commentIDs) > 0 {
		if resolved, err := h.store.CommentContentIDs(commentIDs); err == nil {
			commentContent = resolved
			for _, contentID := range resolved {
				contentIDs = append(contentIDs, contentID)
			}
		}
	}
	contentInfo := map[string]struct{ Slug, Kind string }{}
	if len(contentIDs) > 0 {
		if resolved, err := h.store.ChainContentTargets(contentIDs); err == nil {
			for id, target := range resolved {
				contentInfo[id] = struct{ Slug, Kind string }{Slug: target.Slug, Kind: string(target.Kind)}
			}
		}
	}
	for index := range views {
		views[index].Summary = anchorSummary(views[index])
		views[index].Target = anchorTarget(views[index], commentContent, contentInfo)
	}
	return views
}

// anchorSummary renders a short human description of what a certificate
// commits to, derived from source + metadata (never from the hashed payload).
func anchorSummary(view anchorView) string {
	switch view.Source {
	case chain.SourceContent:
		kind, _ := metadataString(view.Metadata, "kind")
		slug, _ := metadataString(view.Metadata, "slug")
		status, _ := metadataString(view.Metadata, "status")
		version, _ := metadataString(view.Metadata, "version")
		name := "Content"
		if kind == "ARTICLE" {
			name = "Writing"
		} else if kind == "THOUGHT" {
			name = "Thought"
		}
		label := slug
		if label == "" {
			label = "content"
		}
		state := strings.ToLower(status)
		if state == "" {
			state = "updated"
		}
		if version != "" {
			return name + " “" + label + "” · " + state + " · v" + version
		}
		return name + " “" + label + "” · " + state
	case chain.SourceComment:
		return "Comment " + commentActionLabel(view.Metadata)
	case chain.SourceReaction:
		action, _ := metadataString(view.Metadata, "action")
		if action == "removed" {
			return "Like removed"
		}
		return "Like added"
	case chain.SourceMedia:
		action, _ := metadataString(view.Metadata, "action")
		if action == "deleted" {
			return "Media deleted"
		}
		return "Media uploaded"
	case chain.SourceProfile:
		return "Profile updated"
	case chain.SourceSite:
		if target, _ := metadataString(view.Metadata, "target"); target == "pins" {
			return "Pinned content updated"
		}
		return "Site updated"
	case chain.SourceAuth:
		return authActionLabel(view.Metadata)
	case chain.SourceVisitor:
		if view.Label != "" {
			return "Public commitment · “" + view.Label + "”"
		}
		return "Public commitment"
	default: // admin
		if view.Label != "" {
			return "Admin commitment · “" + view.Label + "”"
		}
		return "Admin commitment"
	}
}

// anchorTarget resolves where the subject of an anchor lives, if anywhere.
func anchorTarget(view anchorView, commentContent map[string]string, contentInfo map[string]struct{ Slug, Kind string }) *anchorTargetView {
	switch view.Source {
	case chain.SourceContent:
		kind, _ := metadataString(view.Metadata, "kind")
		slug, _ := metadataString(view.Metadata, "slug")
		if slug == "" {
			return nil
		}
		route := "/thoughts/"
		label := "Thought “" + slug + "”"
		if kind == "ARTICLE" {
			route = "/writing/"
			label = "Writing “" + slug + "”"
		}
		return &anchorTargetView{Kind: "content", Href: route + slug, Label: label}
	case chain.SourceComment:
		contentID, ok := commentContent[view.SubjectRef]
		if !ok {
			return nil
		}
		info, ok := contentInfo[contentID]
		if !ok || info.Slug == "" {
			return nil
		}
		route := "/thoughts/"
		label := "Comments on “" + info.Slug + "”"
		if info.Kind == "ARTICLE" {
			route = "/writing/"
		}
		return &anchorTargetView{Kind: "comment", Href: route + info.Slug + "#comments", Label: label}
	case chain.SourceReaction:
		contentID, ok := metadataString(view.Metadata, "contentId")
		if !ok {
			return nil
		}
		info, ok := contentInfo[contentID]
		if !ok || info.Slug == "" {
			return nil
		}
		route := "/thoughts/"
		if info.Kind == "ARTICLE" {
			route = "/writing/"
		}
		return &anchorTargetView{Kind: "content", Href: route + info.Slug, Label: "“" + info.Slug + "”"}
	case chain.SourceMedia:
		mediaID, ok := metadataString(view.Metadata, "mediaId")
		if !ok || mediaID == "" {
			return nil
		}
		return &anchorTargetView{Kind: "media", Href: "/api/v1/media/" + mediaID, Label: "Open media"}
	default:
		return nil
	}
}

func commentActionLabel(metadata map[string]any) string {
	action, _ := metadataString(metadata, "action")
	switch action {
	case "created":
		return "created"
	case "hidden":
		return "hidden"
	case "unhidden":
		return "unhidden"
	case "deleted":
		return "deleted"
	case "restored":
		return "restored"
	case "author-updated":
		return "author updated"
	default:
		if action == "" {
			return "updated"
		}
		return action
	}
}

func authActionLabel(metadata map[string]any) string {
	action, _ := metadataString(metadata, "action")
	switch action {
	case "login":
		return "Sign-in"
	case "logout":
		return "Sign-out"
	case "logout-all":
		return "Sign-out (all sessions)"
	case "logout-by-id":
		return "Session revoked"
	case "password-changed":
		return "Password changed"
	default:
		if action == "" {
			return "Auth event"
		}
		return "Auth · " + action
	}
}

func metadataString(metadata map[string]any, key string) (string, bool) {
	value, ok := metadata[key]
	if !ok || value == nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	default:
		return "", false
	}
}

// enrichView is the single-anchor variant of enrichAnchorViews.
func (h *apiHandler) enrichView(view anchorView) anchorView {
	enriched := h.enrichAnchorViews([]anchorView{view})
	return enriched[0]
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

// verifyResult assembles VerifyResponse from a subject hash lookup plus the
// full-chain replay (docs/chain.md §10). signatureValid/chainIntegrity always
// report the chain state even when the hash is unknown. The response also
// carries the step-by-step process (steps/merkle/context) so the explorer can
// render how the verification was computed, not just its verdict.
func (h *apiHandler) verifyResult(ledger *chain.Ledger, subjectHash string) (map[string]any, int) {
	report, err := ledger.ReplayVerify()
	if err != nil {
		return map[string]any{"error": map[string]any{"code": "CHAIN_UNAVAILABLE", "message": "Chain verification failed."}}, http.StatusInternalServerError
	}
	anchor, err := ledger.LatestAnchorByHash(subjectHash)
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
		anchorPayload = h.enrichView(toAnchorView(anchor))
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
			if block, _, blockErr := ledger.GetBlock(anchor.BlockID); blockErr == nil {
				blockPayload = blockSummaryOf(block)
				contextPayload = h.blockChainContext(ledger, block)
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
func (h *apiHandler) blockChainContext(ledger *chain.Ledger, block chain.Block) *verifyChainContextView {
	view := &verifyChainContextView{Current: blockSummaryOf(block)}
	if block.Index > 0 {
		if prev, err := ledger.BlockByIndex(block.Index - 1); err == nil {
			view.Prev = blockSummaryOf(prev)
		}
	}
	if next, err := ledger.BlockByIndex(block.Index + 1); err == nil {
		view.Next = blockSummaryOf(next)
	}
	return view
}

// merkleProof derives the audit path for one certificate inside a block's
// merkle tree (docs/chain.md §6): leaf = sha256(cert id), odd layers duplicate
// the last node, parent = sha256(left‖right). Siblings are listed bottom-up.
func merkleProof(certIDs []string, certID, certRoot string) *merkleProofView {
	leafIndex := -1
	for index, id := range certIDs {
		if id == certID {
			leafIndex = index
			break
		}
	}
	if leafIndex < 0 || len(certIDs) == 0 {
		return nil
	}
	level := make([][]byte, len(certIDs))
	for index, id := range certIDs {
		sum := sha256.Sum256([]byte(id))
		level[index] = sum[:]
	}
	leafSum := sha256.Sum256([]byte(certID))
	siblings := make([]merkleSiblingView, 0)
	computations := make([]verifyStepComputationView, 0)
	position := leafIndex
	for len(level) > 1 {
		if len(level)%2 == 1 {
			level = append(level, level[len(level)-1])
		}
		siblingPos := position ^ 1
		side := "right"
		if siblingPos < position {
			side = "left"
		}
		currentHex := hex.EncodeToString(level[position])
		siblingHex := hex.EncodeToString(level[siblingPos])
		siblings = append(siblings, merkleSiblingView{Position: side, Value: siblingHex})
		next := make([][]byte, 0, len(level)/2)
		for index := 0; index < len(level); index += 2 {
			combined := append(append([]byte{}, level[index]...), level[index+1]...)
			sum := sha256.Sum256(combined)
			next = append(next, sum[:])
		}
		parentHex := hex.EncodeToString(next[position/2])
		computations = append(computations, verifyStepComputationView{
			Expression: "sha256(" + currentHex + " ‖ " + siblingHex + ")",
			Value:      parentHex,
		})
		level = next
		position = position / 2
	}
	root := hex.EncodeToString(level[0])
	return &merkleProofView{
		LeafIndex: leafIndex, Leaf: hex.EncodeToString(leafSum[:]), Siblings: siblings, Root: root,
		Matches: root == certRoot, Computations: computations,
	}
}

type verifyStepView struct {
	ID           string                      `json:"id"`
	Label        string                      `json:"label"`
	Status       string                      `json:"status"`
	Detail       string                      `json:"detail"`
	Inputs       []verifyStepInputView       `json:"inputs,omitempty"`
	Computations []verifyStepComputationView `json:"computations,omitempty"`
	Output       string                      `json:"output,omitempty"`
}

type verifyStepInputView struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Note  string `json:"note,omitempty"`
}

type verifyStepComputationView struct {
	Expression string `json:"expression"`
	Value      string `json:"value"`
}

type merkleSiblingView struct {
	Position string `json:"position"`
	Value    string `json:"value"`
}

type merkleProofView struct {
	LeafIndex    int                         `json:"leafIndex"`
	Leaf         string                      `json:"leaf"`
	Siblings     []merkleSiblingView         `json:"siblings"`
	Root         string                      `json:"root"`
	Matches      bool                        `json:"matches"`
	Computations []verifyStepComputationView `json:"computations"`
}

type verifyChainContextView struct {
	Prev    *blockSummaryView `json:"prev"`
	Current *blockSummaryView `json:"current"`
	Next    *blockSummaryView `json:"next"`
}

// shortID renders an id/hash prefix for process details (kept short so the
// explorer tooltips stay scannable).
func shortID(value string) string {
	if len(value) <= 16 {
		return value
	}
	return value[:12] + "…" + value[len(value)-4:]
}

func blockSummaryOf(block chain.Block) *blockSummaryView {
	return &blockSummaryView{
		ID: block.ID, Index: block.Index, PrevHash: block.PrevHash, Timestamp: block.Timestamp,
		CertRoot: block.CertRoot, Nonce: block.Nonce, ProofMode: string(block.ProofMode),
		Difficulty: block.Difficulty, Hash: block.Hash, AnchorCount: len(block.CertIDs),
	}
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
