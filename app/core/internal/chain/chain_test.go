package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func sha256Sum(b []byte) []byte {
	sum := sha256.Sum256(b)
	return sum[:]
}

func TestCanonicalJSONSortsKeysDeterministically(t *testing.T) {
	// The same logical object expressed with different key order must
	// serialize to identical bytes.
	a := map[string]any{"z": 1, "a": map[string]any{"y": true, "b": nil}, "m": []any{"x", 2}}
	b := map[string]any{"m": []any{"x", 2}, "a": map[string]any{"b": nil, "y": true}, "z": 1}
	ca, err := CanonicalJSON(a)
	if err != nil {
		t.Fatal(err)
	}
	cb, err := CanonicalJSON(b)
	if err != nil {
		t.Fatal(err)
	}
	if ca != cb {
		t.Fatalf("canonical mismatch: %s vs %s", ca, cb)
	}
	if ca != `{"a":{"b":null,"y":true},"m":["x",2],"z":1}` {
		t.Fatalf("unexpected canonical form: %s", ca)
	}
}

func TestSubjectHashIsSha256OfRawPayloadBytes(t *testing.T) {
	// Visitor/admin channel payloads hash the exact UTF-8 bytes as
	// submitted; structured payloads hash their canonical JSON string.
	if got := SubjectHashHex([]byte("hello")); got != hex.EncodeToString(sha256Sum([]byte("hello"))) {
		t.Fatalf("raw payload hash mismatch: %s", got)
	}
}

func TestMerkleRootEmptyList(t *testing.T) {
	if got := MerkleRoot(nil); got != hex.EncodeToString(sha256Sum(nil)) {
		t.Fatalf("empty merkle mismatch: %s", got)
	}
}

func TestMerkleRootSingleLeaf(t *testing.T) {
	if got := MerkleRoot([]string{"cert_a"}); got != hex.EncodeToString(sha256Sum([]byte("cert_a"))) {
		t.Fatalf("single-leaf merkle mismatch: %s", got)
	}
}

func TestMerkleRootTwoLeaves(t *testing.T) {
	l0 := sha256Sum([]byte("cert_a"))
	l1 := sha256Sum([]byte("cert_b"))
	combined := append(append([]byte{}, l0...), l1...)
	if got := MerkleRoot([]string{"cert_a", "cert_b"}); got != hex.EncodeToString(sha256Sum(combined)) {
		t.Fatalf("two-leaf merkle mismatch: %s", got)
	}
}

func TestMerkleRootOddLeafDuplicated(t *testing.T) {
	l0 := sha256Sum([]byte("cert_a"))
	l1 := sha256Sum([]byte("cert_b"))
	l2 := sha256Sum([]byte("cert_c"))
	first := sha256Sum(append(append([]byte{}, l0...), l1...))
	second := sha256Sum(append(append([]byte{}, l2...), l2...))
	root := sha256Sum(append(append([]byte{}, first...), second...))
	if got := MerkleRoot([]string{"cert_a", "cert_b", "cert_c"}); got != hex.EncodeToString(root) {
		t.Fatalf("odd-leaf merkle mismatch: %s", got)
	}
}

func TestBlockHashFormulaCoversProofFields(t *testing.T) {
	// hash = sha256("<index>|<prevHash>|<timestamp>|<certRoot>|<proofMode>|<difficulty>|<nonce>")
	// proofMode and difficulty MUST participate so flipping a historical
	// block's mode or difficulty breaks replay verification.
	header := BlockHeader{Index: 1, PrevHash: "abc", Timestamp: "2026-09-06T00:00:00Z", CertRoot: "feed", ProofMode: ProofModeSim, Difficulty: 0, Nonce: 0}
	if got := header.Hash(); got != hex.EncodeToString(sha256Sum([]byte("1|abc|2026-09-06T00:00:00Z|feed|sim|0|0"))) {
		t.Fatalf("block hash formula mismatch: %s", got)
	}
	if header.ProofMode != ProofModeSim || !header.Satisfies() {
		t.Fatal("sim header with difficulty 0 must satisfy its (trivial) target")
	}
}

func TestHasLeadingZeros(t *testing.T) {
	if !HasLeadingZeros("0000ff", 4) {
		t.Fatal("expected 4 leading zeros")
	}
	if HasLeadingZeros("00fff0", 3) {
		t.Fatal("expected only 2 leading zeros")
	}
	if !HasLeadingZeros("ff", 0) {
		t.Fatal("difficulty 0 always passes")
	}
	if HasLeadingZeros("00", 3) {
		t.Fatal("hash shorter than difficulty must fail")
	}
}

func TestSignAndVerifySubjectHash(t *testing.T) {
	publicHex, privateHex, err := NewSiteKey()
	if err != nil {
		t.Fatal(err)
	}
	subjectHash := SubjectHashHex([]byte("payload"))
	signature, err := SignSubjectHash(privateHex, subjectHash)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifySubjectHash(publicHex, subjectHash, signature) {
		t.Fatal("signature must verify with the signing key")
	}
	if VerifySubjectHash("0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", subjectHash, signature) {
		t.Fatal("signature must not verify with a foreign key")
	}
	if VerifySubjectHash(publicHex, SubjectHashHex([]byte("other")), signature) {
		t.Fatal("signature must not verify for a different subject")
	}
}
