package handler

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/manifold-space/manifold/app/core/internal/chain"
)

type merkleSiblingView struct {
	Position string `json:"position"`
	Value    string `json:"value"`
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
