package runtime_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestAgentUsesSevenTopLevelModules(t *testing.T) {
	entries, err := os.ReadDir("..")
	if err != nil {
		t.Fatal(err)
	}

	var modules []string
	for _, entry := range entries {
		if entry.IsDir() {
			modules = append(modules, entry.Name())
		}
	}
	slices.Sort(modules)
	want := []string{"conversation", "memory", "prompt", "provider", "runtime", "scenario", "tool"}
	if !slices.Equal(modules, want) {
		t.Fatalf("agent modules = %v, want %v", modules, want)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		t.Errorf("agent root contains file %q", entry.Name())
	}
}

func TestOnlyRuntimeDependsOnRuntime(t *testing.T) {
	const runtimeImportPath = "github.com/manifold-space/manifold/app/core/internal/agent/runtime"
	for _, module := range []string{"conversation", "memory", "prompt", "provider", "scenario", "tool"} {
		err := filepath.WalkDir(filepath.Join("..", module), func(filePath string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(filePath, ".go") {
				return nil
			}
			file, err := parser.ParseFile(token.NewFileSet(), filePath, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imported := range file.Imports {
				importPath, err := strconv.Unquote(imported.Path.Value)
				if err != nil {
					return err
				}
				if importPath == runtimeImportPath || strings.HasPrefix(importPath, runtimeImportPath+"/") {
					t.Errorf("%s imports runtime", filePath)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
