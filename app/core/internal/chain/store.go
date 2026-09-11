package chain

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func NewLedger(db *sql.DB, cfg LedgerConfig) *Ledger {
	if !cfg.ProofMode.Valid() {
		cfg.ProofMode = ProofModeSim
	}
	if cfg.MaxBlockAnchors < 1 {
		cfg.MaxBlockAnchors = 500
	}
	if cfg.BatchSize < 1 {
		cfg.BatchSize = 32
	}
	return &Ledger{db: db, cfg: cfg, wake: make(chan struct{}, 1)}
}

// Tip returns the highest block; ErrEmptyChain on a fresh database.
func (l *Ledger) Tip() (Block, error) {
	block, err := l.scanBlock(l.db.QueryRow(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index DESC LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return Block{}, ErrEmptyChain
	}
	return block, err
}

const blockColumns = `id, block_index, prev_hash, timestamp, cert_root, cert_ids_json, nonce, proof_mode, difficulty, hash`

func (l *Ledger) scanBlock(row interface{ Scan(dest ...any) error }) (Block, error) {
	var block Block
	var certIDsJSON string
	var mode string
	if err := row.Scan(&block.ID, &block.Index, &block.PrevHash, &block.Timestamp, &block.CertRoot, &certIDsJSON, &block.Nonce, &mode, &block.Difficulty, &block.Hash); err != nil {
		return Block{}, err
	}
	block.ProofMode = ProofMode(mode)
	if err := json.Unmarshal([]byte(certIDsJSON), &block.CertIDs); err != nil {
		return Block{}, err
	}
	if block.CertIDs == nil {
		block.CertIDs = []string{}
	}
	return block, nil
}

// ErrTipMoved reports that the chain tip changed between the mining decision
// and the insert; the caller re-evaluates with the new tip.
var ErrTipMoved = errors.New("chain tip moved during mining")

// mineHeader assembles the block header and runs PoW against a tip snapshot
// taken before mining starts. It holds no transaction: with the single SQLite
// connection, mining inside the tx would hold the database busy for the sim
// delay or the whole proof search, stalling every request (docs/chain.md §9).
func (l *Ledger) mineHeader(ctx context.Context, certIDs []string) (BlockHeader, error) {
	difficulty := l.cfg.Difficulty
	if l.cfg.ProofMode == ProofModeSim {
		difficulty = 0
	}
	tip, err := l.Tip()
	if err != nil && !errors.Is(err, ErrEmptyChain) {
		return BlockHeader{}, err
	}
	emptyChain := errors.Is(err, ErrEmptyChain)
	if emptyChain && len(certIDs) > 0 {
		return BlockHeader{}, errors.New("genesis must carry no certificates; mine it first, then pack")
	}
	header := BlockHeader{Index: 0, PrevHash: strings.Repeat("0", 64), Timestamp: time.Now().UTC().Format(time.RFC3339),
		CertRoot: MerkleRoot(certIDs), ProofMode: l.cfg.ProofMode, Difficulty: difficulty}
	if !emptyChain {
		header.Index = tip.Index + 1
		header.PrevHash = tip.Hash
	}

	// PoW: sim sleeps its configured delay and keeps nonce 0; proof searches
	// for a real leading-zero collision.
	switch l.cfg.ProofMode {
	case ProofModeSim:
		timer := time.NewTimer(l.cfg.SimDelay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return BlockHeader{}, ctx.Err()
		case <-timer.C:
		}
	default:
		for header.Nonce = 0; ; header.Nonce++ {
			if header.Nonce%1024 == 0 {
				if err := ctx.Err(); err != nil {
					return BlockHeader{}, err
				}
			}
			if header.Satisfies() {
				break
			}
		}
	}
	header.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return header, nil
}

// InsertBlock assembles and mines one block over certIDs: the header and PoW
// run outside any transaction (holding the single connection for the sim
// delay or a proof search would stall every request), then a short
// transaction re-checks that the tip is still the one mined against, inserts
// the block and backfills pending→anchored (the only legal UPDATE on the
// chain tables). Genesis is mined by calling with nil certs on an empty chain.
func (l *Ledger) InsertBlock(certIDs []string) (Block, error) {
	return l.InsertBlockContext(context.Background(), certIDs)
}

// InsertBlockContext behaves like InsertBlock and allows an in-flight proof
// search or simulated delay to stop when the caller is shutting down.
func (l *Ledger) InsertBlockContext(ctx context.Context, certIDs []string) (Block, error) {
	if certIDs == nil {
		certIDs = []string{}
	}
	if len(certIDs) > l.cfg.MaxBlockAnchors {
		certIDs = certIDs[:l.cfg.MaxBlockAnchors]
	}
	header, err := l.mineHeader(ctx, certIDs)
	if err != nil {
		return Block{}, err
	}
	if err := ctx.Err(); err != nil {
		return Block{}, err
	}

	tx, err := l.db.Begin()
	if err != nil {
		return Block{}, err
	}
	defer func() { _ = tx.Rollback() }()

	tip, err := l.tipTx(tx)
	if err != nil {
		return Block{}, err
	}
	if tip == nil && header.Index != 0 || tip != nil && (tip.Index != header.Index-1 || tip.Hash != header.PrevHash) {
		return Block{}, ErrTipMoved
	}
	certIDsJSON, err := json.Marshal(certIDs)
	if err != nil {
		return Block{}, err
	}
	if _, err := tx.Exec(`INSERT INTO chain_blocks (id, block_index, prev_hash, timestamp, cert_root, cert_ids_json, nonce, proof_mode, difficulty, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		fmt.Sprintf("block_%d", header.Index), header.Index, header.PrevHash, header.Timestamp, header.CertRoot, string(certIDsJSON),
		header.Nonce, string(header.ProofMode), header.Difficulty, header.Hash()); err != nil {
		return Block{}, err
	}
	if len(certIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(certIDs)), ",")
		args := make([]any, 0, len(certIDs)+1)
		args = append(args, fmt.Sprintf("block_%d", header.Index))
		for _, id := range certIDs {
			args = append(args, id)
		}
		if _, err := tx.Exec(`UPDATE chain_anchors SET block_id = ? WHERE id IN (`+placeholders+`) AND block_id IS NULL`, args...); err != nil {
			return Block{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Block{}, err
	}
	return Block{ID: fmt.Sprintf("block_%d", header.Index), Index: header.Index, PrevHash: header.PrevHash, Timestamp: header.Timestamp,
		CertRoot: header.CertRoot, CertIDs: certIDs, Nonce: header.Nonce, ProofMode: header.ProofMode,
		Difficulty: header.Difficulty, Hash: header.Hash()}, nil
}

func (l *Ledger) tipTx(tx *sql.Tx) (*Block, error) {
	block, err := l.scanBlock(tx.QueryRow(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index DESC LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &block, nil
}

// ListBlocks pages block summaries newest-first.
func (l *Ledger) ListBlocks(page, pageSize int) ([]Block, int, error) {
	var total int
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_blocks`).Scan(&total); err != nil {
		return nil, 0, err
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if page < 1 {
		page = 1
	}
	rows, err := l.db.Query(`SELECT `+blockColumns+` FROM chain_blocks ORDER BY block_index DESC LIMIT ? OFFSET ?`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	blocks := make([]Block, 0)
	for rows.Next() {
		block, err := l.scanBlock(rows)
		if err != nil {
			return nil, 0, err
		}
		blocks = append(blocks, block)
	}
	return blocks, total, rows.Err()
}

// GetBlock returns one block with its contained anchors.
// BlockByIndex fetches a single block by its chain index (used to render the
// block before/after a verified certificate in the explorer's chain context).
func (l *Ledger) BlockByIndex(index int) (Block, error) {
	block, err := l.scanBlock(l.db.QueryRow(`SELECT `+blockColumns+` FROM chain_blocks WHERE block_index = ?`, index))
	if errors.Is(err, sql.ErrNoRows) {
		return Block{}, sql.ErrNoRows
	}
	if err != nil {
		return Block{}, err
	}
	return block, nil
}

func (l *Ledger) GetBlock(id string) (Block, []Anchor, error) {
	block, err := l.scanBlock(l.db.QueryRow(`SELECT `+blockColumns+` FROM chain_blocks WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Block{}, nil, sql.ErrNoRows
	}
	if err != nil {
		return Block{}, nil, err
	}
	anchors := make([]Anchor, 0)
	if len(block.CertIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(block.CertIDs)), ",")
		args := make([]any, 0, len(block.CertIDs))
		for _, id := range block.CertIDs {
			args = append(args, id)
		}
		rows, err := l.db.Query(`SELECT `+anchorColumns+` FROM chain_anchors WHERE id IN (`+placeholders+`)`, args...)
		if err != nil {
			return Block{}, nil, err
		}
		defer rows.Close()
		if anchors, err = l.collectAnchors(rows); err != nil {
			return Block{}, nil, err
		}
	}
	return block, anchors, nil
}

// AllBlocks streams the whole chain in index order for replay verification.
func (l *Ledger) AllBlocks() ([]Block, error) {
	rows, err := l.db.Query(`SELECT ` + blockColumns + ` FROM chain_blocks ORDER BY block_index ASC`)
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

func (l *Ledger) ChainInfo() (ChainInfoResult, error) {
	info := ChainInfoResult{ProofMode: l.cfg.ProofMode, Difficulty: l.cfg.Difficulty}
	if l.cfg.ProofMode == ProofModeSim {
		info.Difficulty = 0
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_blocks`).Scan(&info.Height); err != nil {
		return info, err
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors`).Scan(&info.TotalAnchors); err != nil {
		return info, err
	}
	if err := l.db.QueryRow(`SELECT COUNT(*) FROM chain_anchors WHERE block_id IS NULL`).Scan(&info.PendingAnchors); err != nil {
		return info, err
	}
	if info.Height > 0 {
		var genesisHash, tipHash string
		if err := l.db.QueryRow(`SELECT hash FROM chain_blocks WHERE block_index = 0`).Scan(&genesisHash); err != nil {
			return info, err
		}
		if err := l.db.QueryRow(`SELECT hash FROM chain_blocks ORDER BY block_index DESC LIMIT 1`).Scan(&tipHash); err != nil {
			return info, err
		}
		info.GenesisHash = genesisHash
		info.TipHash = tipHash
	}
	if key, err := l.EnsureSiteKey(); err == nil {
		info.SitePublicKey = key.PublicKey
	}
	return info, nil
}

// Wake nudges the miner loop; never blocks, never drops work.
func (l *Ledger) Wake() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}
