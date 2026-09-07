package chain

import (
	"database/sql"
	"fmt"
)

// ReplayReport is the full-chain verification outcome (docs/chain.md §10):
// every tamper — block fields, hash linkage, merkle roots, certificate rows
// or signatures — surfaces as a located problem.
type ReplayReport struct {
	Intact   bool
	Height   int
	Problems []string
}

// ReplayVerify walks genesis→tip: recomputes each block hash (proofMode and
// difficulty included in the pre-image), checks index continuity and
// prev-hash linkage, enforces PoW targets for proof blocks, recomputes each
// cert root from cert_ids_json, and verifies every anchored certificate's
// ed25519 signature. Pending anchors are not part of the chain yet.
//
// The whole walk runs inside one read transaction: the miner goroutine may
// commit a block mid-replay, and without a snapshot the orphan scan could
// observe an anchor whose containing block the block query never saw — a
// phantom tamper report under concurrency, not a real one.
func (l *Ledger) ReplayVerify() (ReplayReport, error) {
	tx, err := l.db.Begin()
	if err != nil {
		return ReplayReport{}, err
	}
	// Read-only intent: every statement is a SELECT; rollback is enough.
	defer func() { _ = tx.Rollback() }()
	report, err := l.replayTx(tx)
	if err != nil {
		return report, err
	}
	return report, tx.Commit()
}

func (l *Ledger) replayTx(tx *sql.Tx) (ReplayReport, error) {
	blocks, err := l.blocksTx(tx)
	if err != nil {
		return ReplayReport{}, err
	}
	report := ReplayReport{Height: len(blocks)}
	add := func(format string, args ...any) {
		report.Problems = append(report.Problems, fmt.Sprintf(format, args...))
	}
	byID := make(map[string]Anchor, len(blocks)*4)
	for index, block := range blocks {
		if block.Index != index {
			add("block %s: index %d breaks continuity (expected %d)", block.ID, block.Index, index)
		}
		prevHash := genesisPrevHash
		if index > 0 {
			prevHash = blocks[index-1].Hash
		}
		if block.PrevHash != prevHash {
			add("block %s: prev_hash does not chain to block %d", block.ID, index-1)
		}
		header := BlockHeader{Index: block.Index, PrevHash: block.PrevHash, Timestamp: block.Timestamp,
			CertRoot: block.CertRoot, ProofMode: block.ProofMode, Difficulty: block.Difficulty, Nonce: block.Nonce}
		if recomputed := header.Hash(); recomputed != block.Hash {
			add("block %s: stored hash %s does not match recomputed %s", block.ID, block.Hash, recomputed)
		}
		if block.ProofMode == ProofModeProof && !header.Satisfies() {
			add("block %s: proof-mode hash does not meet difficulty %d", block.ID, block.Difficulty)
		}
		if root := MerkleRoot(block.CertIDs); root != block.CertRoot {
			add("block %s: cert_root %s does not match merkle root %s", block.ID, block.CertRoot, root)
		}
		if len(block.CertIDs) > 0 {
			anchors, err := l.anchorsByIDsTx(tx, block.CertIDs)
			if err != nil {
				return report, err
			}
			seen := make(map[string]bool, len(anchors))
			for _, anchor := range anchors {
				seen[anchor.ID] = true
				byID[anchor.ID] = anchor
				if anchor.BlockID != block.ID {
					add("anchor %s: block_id %s does not match containing block %s", anchor.ID, anchor.BlockID, block.ID)
				}
				if !VerifySubjectHash(anchor.SitePublicKey, anchor.SubjectHash, anchor.SiteSignature) {
					add("anchor %s: site signature does not verify", anchor.ID)
				}
			}
			for _, id := range block.CertIDs {
				if !seen[id] {
					add("block %s: cert %s is missing from chain_anchors", block.ID, id)
				}
			}
		}
	}
	// Anchors claiming a block seat that no block claims back — same snapshot.
	rows, err := tx.Query(`SELECT id, block_id FROM chain_anchors WHERE block_id IS NOT NULL`)
	if err != nil {
		return report, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, blockID string
		if err := rows.Scan(&id, &blockID); err != nil {
			return report, err
		}
		if anchor, ok := byID[id]; !ok || anchor.BlockID != blockID {
			add("anchor %s: block_id %s has no matching block membership", id, blockID)
		}
	}
	if err := rows.Err(); err != nil {
		return report, err
	}
	report.Intact = len(report.Problems) == 0
	return report, nil
}

const genesisPrevHash = "0000000000000000000000000000000000000000000000000000000000000000"

func (l *Ledger) blocksTx(tx *sql.Tx) ([]Block, error) {
	rows, err := tx.Query(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	blocks := make([]Block, 0)
	for rows.Next() {
		block, err := l.scanBlock(rows)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, block)
	}
	return blocks, rows.Err()
}

func (l *Ledger) anchorsByIDsTx(tx *sql.Tx, ids []string) ([]Anchor, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := ""
	args := make([]any, 0, len(ids))
	for i, id := range ids {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, id)
	}
	rows, err := tx.Query(`SELECT `+anchorColumns+` FROM chain_anchors WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return l.collectAnchors(rows)
}
