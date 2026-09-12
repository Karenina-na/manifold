// Package chain implements Manifold's generic anchoring ledger: canonical
// hashing, site-key signing, block assembly and proof-of-work. It knows nothing
// about business payloads — callers construct those per docs/chain.md §4.
package chain

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

type ProofMode string

const (
	// ProofModeSim mines with a fixed delay and a trivial difficulty-0 target:
	// the block structure is real, the collision search is not.
	ProofModeSim ProofMode = "sim"
	// ProofModeProof runs a real SHA-256 leading-zero collision search.
	ProofModeProof ProofMode = "proof"
)

func (m ProofMode) Valid() bool { return m == ProofModeSim || m == ProofModeProof }

// Proof-of-work difficulty bounds, counted in leading hex zeros. The upper
// bound is what keeps a misconfigured difficulty from turning the miner into an
// unbounded hash search: the target costs 16^difficulty hashes, so 6 is a few
// seconds on one core (~1.7e7 hashes at ~5 Mhash/s) while 8 is a quarter of an
// hour and 12 is years — and InsertBlock only learns about shutdown from ctx.
// config.Validate refuses an out-of-range value; NewLedger clamps as a second
// line of defence for programmatic callers (docs/chain.md §5).
const (
	MinProofDifficulty = 1
	MaxProofDifficulty = 6
)

// ClampProofDifficulty bounds difficulty to the supported proof-mode range.
func ClampProofDifficulty(difficulty int) int {
	if difficulty < MinProofDifficulty {
		return MinProofDifficulty
	}
	if difficulty > MaxProofDifficulty {
		return MaxProofDifficulty
	}
	return difficulty
}

// BlockHeader is the deterministic pre-image of a block hash. Every field a
// verifier checks must participate in the hash: flipping a historical block's
// proofMode or difficulty would otherwise go undetected by replay (docs/chain.md §3.4).
type BlockHeader struct {
	Index      int
	PrevHash   string
	Timestamp  string
	CertRoot   string
	ProofMode  ProofMode
	Difficulty int
	Nonce      int
}

// Hash computes sha256("<index>|<prevHash>|<timestamp>|<certRoot>|<proofMode>|<difficulty>|<nonce>").
func (h BlockHeader) Hash() string {
	preimage := strconv.Itoa(h.Index) + "|" + h.PrevHash + "|" + h.Timestamp + "|" + h.CertRoot + "|" + string(h.ProofMode) + "|" + strconv.Itoa(h.Difficulty) + "|" + strconv.Itoa(h.Nonce)
	sum := sha256.Sum256([]byte(preimage))
	return hex.EncodeToString(sum[:])
}

// Satisfies reports whether the header's hash meets its PoW target. Sim blocks
// store difficulty 0 — a deliberately trivial target that always passes.
func (h BlockHeader) Satisfies() bool { return HasLeadingZeros(h.Hash(), h.Difficulty) }

// HasLeadingZeros reports whether hashHex starts with count '0' characters.
func HasLeadingZeros(hashHex string, count int) bool {
	if count == 0 {
		return true
	}
	if len(hashHex) < count {
		return false
	}
	for i := 0; i < count; i++ {
		if hashHex[i] != '0' {
			return false
		}
	}
	return true
}

// CanonicalJSON serializes v to compact JSON with object keys recursively
// sorted by UTF-8 byte order, so the same logical object always hashes equal.
func CanonicalJSON(v any) (string, error) {
	normalized, err := normalizeValue(v)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func normalizeValue(v any) (any, error) {
	switch value := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(value))
		for _, key := range keys {
			normalized, err := normalizeValue(value[key])
			if err != nil {
				return nil, err
			}
			out[key] = normalized
		}
		return out, nil
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			normalized, err := normalizeValue(item)
			if err != nil {
				return nil, err
			}
			out[i] = normalized
		}
		return out, nil
	case json.RawMessage:
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return nil, fmt.Errorf("canonical json: %w", err)
		}
		return normalizeValue(decoded)
	default:
		return v, nil
	}
}

// SubjectHashHex returns the hex sha256 of raw payload bytes. Visitor/admin
// channel payloads hash the exact bytes as submitted; structured payloads pass
// their canonical JSON string.
func SubjectHashHex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// MerkleRoot computes the merkle root over ordered cert ids: leaves are
// sha256(certId), parents sha256(left||right), an odd leaf is duplicated, and
// an empty list collapses to sha256("") (docs/chain.md §3.4).
func MerkleRoot(certIDs []string) string {
	if len(certIDs) == 0 {
		sum := sha256.Sum256(nil)
		return hex.EncodeToString(sum[:])
	}
	level := make([][]byte, len(certIDs))
	for i, id := range certIDs {
		sum := sha256.Sum256([]byte(id))
		level[i] = sum[:]
	}
	for len(level) > 1 {
		if len(level)%2 == 1 {
			level = append(level, level[len(level)-1])
		}
		next := make([][]byte, 0, len(level)/2)
		for i := 0; i < len(level); i += 2 {
			combined := append(append([]byte{}, level[i]...), level[i+1]...)
			sum := sha256.Sum256(combined)
			next = append(next, sum[:])
		}
		level = next
	}
	return hex.EncodeToString(level[0])
}

// NewSiteKey generates a fresh ed25519 key pair. The private hex is the 32-byte
// seed (not the 64-byte seed||public composite). The key's protection is the
// SQLite file itself — same grade as the data, not HSM/KMS (docs/chain.md §3.3).
func NewSiteKey() (publicHex, privateHex string, err error) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	return hex.EncodeToString(public), hex.EncodeToString(private.Seed()), nil
}

// SignSubjectHash signs the subject hash hex string (as UTF-8 bytes) with a
// hex ed25519 private seed.
func SignSubjectHash(privateHex, subjectHash string) (string, error) {
	private, err := hex.DecodeString(privateHex)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	if len(private) != ed25519.SeedSize {
		return "", fmt.Errorf("private key must be a %d-byte seed", ed25519.SeedSize)
	}
	signature := ed25519.Sign(ed25519.NewKeyFromSeed(private), []byte(subjectHash))
	return hex.EncodeToString(signature), nil
}

// VerifySubjectHash checks a hex signature against a hex public key.
func VerifySubjectHash(publicHex, subjectHash, signatureHex string) bool {
	public, err := hex.DecodeString(publicHex)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return false
	}
	signature, err := hex.DecodeString(signatureHex)
	if err != nil {
		return false
	}
	return ed25519.Verify(public, []byte(subjectHash), signature)
}
