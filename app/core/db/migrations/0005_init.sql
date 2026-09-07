-- Generic anchoring chain (docs/chain.md §8): site keys, anchor certificates
-- and PoW blocks. The two chain tables are append-only — the only legal UPDATE
-- is the miner backfilling chain_anchors.block_id from NULL, and that
-- invariant is enforced by code paths plus the full-chain replay verifier,
-- not by SQL triggers. source and proof_mode deliberately carry no SQL CHECK:
-- enums live in Go constants and contracts so new values need no table change.

CREATE TABLE IF NOT EXISTS chain_keys (
    key_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE,
    private_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_anchors (
    id TEXT PRIMARY KEY,
    subject_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    subject_ref TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    site_key_id TEXT NOT NULL,
    site_public_key TEXT NOT NULL,
    site_signature TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    block_id TEXT REFERENCES chain_blocks(id)
);

CREATE TABLE IF NOT EXISTS chain_blocks (
    id TEXT PRIMARY KEY,
    block_index INTEGER NOT NULL UNIQUE,
    prev_hash TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cert_root TEXT NOT NULL,
    cert_ids_json TEXT NOT NULL DEFAULT '[]',
    nonce INTEGER NOT NULL DEFAULT 0,
    proof_mode TEXT NOT NULL,
    difficulty INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chain_anchors_pending ON chain_anchors(created_at) WHERE block_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chain_anchors_subject ON chain_anchors(subject_hash);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_ref ON chain_anchors(subject_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_source ON chain_anchors(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_block ON chain_anchors(block_id);
