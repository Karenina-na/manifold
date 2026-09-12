package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/chain"
)

func TestApplyDotEnvFileParsesLiteralValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\n\nCORE_ADDR=:9999\nCORE_JWT_SECRET='$2a$10$hash/with$dollars'\nCORE_SEED_FILE=\"seed/custom.json\"\nexport CORE_PUBLIC_URL=https://example.com\n\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CORE_SEED_FILE", "already-set")
	for _, key := range []string{"CORE_ADDR", "CORE_JWT_SECRET", "CORE_PUBLIC_URL"} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}
	t.Cleanup(func() { os.Unsetenv("CORE_SEED_FILE") })

	if err := applyDotEnvFile(path); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("CORE_ADDR"); got != ":9999" {
		t.Fatalf("CORE_ADDR = %q", got)
	}
	if got := os.Getenv("CORE_JWT_SECRET"); got != "$2a$10$hash/with$dollars" {
		t.Fatalf("bcrypt hash must survive verbatim, got %q", got)
	}
	if got := os.Getenv("CORE_SEED_FILE"); got != "already-set" {
		t.Fatalf("existing environment must win over .env, got %q", got)
	}
	if got := os.Getenv("CORE_PUBLIC_URL"); got != "https://example.com" {
		t.Fatalf("export prefix should be tolerated, got %q", got)
	}
}

func TestApplyDotEnvFileRejectsMalformedLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("NO_EQUALS_SIGN\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := applyDotEnvFile(path); err == nil {
		t.Fatal("expected malformed line to fail fast")
	}
}

func TestFindDotEnvWalksUpToRepositoryRoot(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "app", "core")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(root, ".env")
	if err := os.WriteFile(envPath, []byte("CORE_ADDR=:8080\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := findDotEnv(nested); got != envPath {
		t.Fatalf("expected walk-up to find %s, got %q", envPath, got)
	}
	emptyRoot := filepath.Join(t.TempDir(), "empty")
	if err := os.MkdirAll(emptyRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := findDotEnv(emptyRoot); got != "" {
		t.Fatalf("expected no .env in a clean tree, got %q", got)
	}
}

func TestLoadReadsSeedFileFromDotEnv(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CORE_SEED_FILE=seed/custom.json\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Unsetenv("CORE_SEED_FILE") })
	t.Chdir(dir)

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SeedFile != "seed/custom.json" {
		t.Fatalf("CORE_SEED_FILE not loaded from .env, got %q", cfg.SeedFile)
	}
	if cfg.Env != "development" {
		t.Fatalf("unexpected env default: %q", cfg.Env)
	}
}

func TestValidateRejectsInvalidTrustedProxyCIDR(t *testing.T) {
	cfg := Config{
		Env:               "production",
		JWTSecret:         "a-production-secret",
		AdminPasswordHash: "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X",
		TrustedProxyCIDRs: []string{"127.0.0.1/32", "not-a-cidr"},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid trusted proxy CIDR to be rejected")
	}
}

func TestValidateAllowsEmptyTrustedProxyDefault(t *testing.T) {
	cfg := Config{
		Env:               "production",
		JWTSecret:         "a-production-secret",
		AdminPasswordHash: "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X",
		TrustedProxyCIDRs: []string{""},
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("empty trusted proxy default must be allowed: %v", err)
	}
}

// The difficulty bound is checked in every environment, not just production:
// an out-of-range value makes the miner's collision search effectively
// unbounded, which is a resource fault rather than a deployment-secret mistake
// (docs/chain.md §5).
func TestValidateBoundsChainDifficultyInProofMode(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		difficulty int
		wantError  bool
	}{
		{"at the floor", chain.MinProofDifficulty, false},
		{"at the cap", chain.MaxProofDifficulty, false},
		{"inside the range", 4, false},
		{"below the floor", chain.MinProofDifficulty - 1, true},
		{"above the cap", chain.MaxProofDifficulty + 1, true},
	} {
		cfg := Config{Env: "development", ChainProofMode: "proof", ChainDifficulty: testCase.difficulty}
		err := cfg.Validate()
		if testCase.wantError != (err != nil) {
			t.Fatalf("%s: Validate() error = %v, wantError %v", testCase.name, err, testCase.wantError)
		}
	}
}

// Sim mode ignores difficulty — the miner forces the target to 0 and the stored
// block records 0 — so an out-of-range value there is inert and must not stop a
// process that was previously running happily.
func TestValidateIgnoresChainDifficultyOutsideProofMode(t *testing.T) {
	for _, mode := range []string{"sim", "", "unknown"} {
		cfg := Config{Env: "development", ChainProofMode: mode, ChainDifficulty: 64}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("mode %q must ignore difficulty: %v", mode, err)
		}
	}
}

// The built-in default has to be a value proof mode accepts, otherwise
// enabling proof mode on its own would refuse to boot.
func TestDefaultChainDifficultyIsValidForProofMode(t *testing.T) {
	t.Chdir(t.TempDir())
	if previous, ok := os.LookupEnv("CORE_CHAIN_DIFFICULTY"); ok {
		t.Cleanup(func() { _ = os.Setenv("CORE_CHAIN_DIFFICULTY", previous) })
	}
	_ = os.Unsetenv("CORE_CHAIN_DIFFICULTY")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ChainDifficulty < chain.MinProofDifficulty || cfg.ChainDifficulty > chain.MaxProofDifficulty {
		t.Fatalf("default CORE_CHAIN_DIFFICULTY = %d is outside the proof-mode range [%d, %d]",
			cfg.ChainDifficulty, chain.MinProofDifficulty, chain.MaxProofDifficulty)
	}
	cfg.ChainProofMode = "proof"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("the default difficulty must be accepted in proof mode: %v", err)
	}
}
