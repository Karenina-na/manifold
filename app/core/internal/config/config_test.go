package config

import (
	"os"
	"path/filepath"
	"testing"
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
