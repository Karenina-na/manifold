package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// loadDotEnv applies KEY=VALUE pairs from the nearest .env file, searching
// upward from the working directory, so `make core-run` (which executes
// inside app/core) still picks up the repository-root file. Two deliberate
// properties replace a dotenv dependency:
//
//   - Values are literal bytes, never shell-expanded, so bcrypt hashes
//     containing `$` survive unchanged.
//   - Variables that already exist in the environment always win, so explicit
//     injection (CI, docker, test harnesses) overrides file defaults.
//
// A missing file is not an error; a malformed line is.
func loadDotEnv() error {
	dir, err := os.Getwd()
	if err != nil {
		return nil
	}
	path := findDotEnv(dir)
	if path == "" {
		return nil
	}
	return applyDotEnvFile(path)
}

func findDotEnv(startDir string) string {
	dir := startDir
	for {
		candidate := filepath.Join(dir, ".env")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func applyDotEnvFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	for lineNumber, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		if !found {
			return fmt.Errorf("%s line %d: expected KEY=VALUE", path, lineNumber+1)
		}
		key = strings.TrimSpace(key)
		value = unquote(strings.TrimSpace(value))
		if key == "" {
			return fmt.Errorf("%s line %d: empty variable name", path, lineNumber+1)
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("%s line %d: apply %s: %w", path, lineNumber+1, key, err)
		}
	}
	return nil
}

// unquote strips one symmetric layer of surrounding quotes without
// interpreting escapes, keeping values byte-faithful.
func unquote(value string) string {
	if len(value) >= 2 && (value[0] == '"' && value[len(value)-1] == '"' || value[0] == '\'' && value[len(value)-1] == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}
