package manifold_test

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/scenarios/manifold"
	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type manifoldSource struct{}

func (manifoldSource) GetProfile(context.Context) (model.Profile, error) {
	return model.Profile{}, nil
}

func (manifoldSource) ListContent(context.Context, bool, store.ContentListOptions) (store.ContentListResult, error) {
	return store.ContentListResult{}, nil
}

func (manifoldSource) GetContentBySlug(context.Context, string, bool) (model.Content, error) {
	title := "A writing"
	return model.Content{ID: "writing_1", Kind: model.ContentKindArticle, Status: model.StatusPublished, Slug: "a-writing", Title: &title, Body: "# A writing"}, nil
}

type chainSource struct{}

func (chainSource) ChainInfo(context.Context) (chain.ChainInfoResult, error) {
	return chain.ChainInfoResult{}, nil
}

func (chainSource) LatestContentAnchor(context.Context, string) (chain.Anchor, error) {
	return chain.Anchor{}, sql.ErrNoRows
}

func TestFactoryRegistersPromptAndScenarioTools(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	if err := manifold.Register(registry, manifold.Dependencies{Profile: manifoldSource{}, Content: manifoldSource{}}); err != nil {
		t.Fatal(err)
	}

	scenario, err := registry.Build(manifold.Name)
	if err != nil {
		t.Fatal(err)
	}
	prompt := scenario.Prompt.Build(scenario.Tools.Definitions())
	for _, heading := range []string{
		"You are the private Manifold assistant.",
		"ROLE",
		"INSTRUCTION SCOPE",
		"SOURCE PRIORITY",
		"TOOL USE",
		"CAPABILITY BOUNDARIES",
		"UNTRUSTED DATA HANDLING",
		"KNOWLEDGE BOUNDARIES",
		"SCOPE AND SAFETY",
		"STYLE",
		"UNCERTAINTY AND ERRORS",
		"OUTPUT CONTRACT",
	} {
		if !strings.Contains(prompt, heading) {
			t.Fatalf("Manifold prompt is missing %q:\n%s", heading, prompt)
		}
	}
	if !strings.Contains(prompt, "content_list is read-only.") {
		t.Fatalf("Manifold prompt is missing the runtime-generated capability boundary:\n%s", prompt)
	}
	for _, definition := range scenario.Tools.Definitions() {
		if definition.Usage == "" {
			t.Fatalf("tool %q must provide prompt usage guidance", definition.Name)
		}
		if definition.Effect != agenttool.ToolEffectReadOnly {
			t.Fatalf("tool %q must be read-only in the current scenario, got %q", definition.Name, definition.Effect)
		}
		if !strings.Contains(prompt, definition.Name) || !strings.Contains(prompt, definition.Usage) {
			t.Fatalf("Manifold prompt is missing guidance for %q:\n%s", definition.Name, prompt)
		}
	}
	names := toolNames(scenario)
	want := []string{"calculator", "content_get", "content_list", "get_current_time", "get_user_profile"}
	if !slices.Equal(names, want) {
		t.Fatalf("unexpected Manifold tools: %v", names)
	}
}

func TestFactoryAddsChainToolsOnlyWhenAvailable(t *testing.T) {
	registry := agent.NewScenarioRegistry()
	if err := manifold.Register(registry, manifold.Dependencies{Profile: manifoldSource{}, Content: manifoldSource{}, Chain: chainSource{}, ChainAnchors: chainSource{}}); err != nil {
		t.Fatal(err)
	}

	scenario, err := registry.Build(manifold.Name)
	if err != nil {
		t.Fatal(err)
	}
	if names := toolNames(scenario); !slices.Contains(names, "get_chain_status") {
		t.Fatalf("chain-enabled Manifold scenario is missing get_chain_status: %v", names)
	}
	if names := toolNames(scenario); !slices.Contains(names, "get_content_anchor") {
		t.Fatalf("chain-enabled Manifold scenario is missing get_content_anchor: %v", names)
	}
}

func toolNames(scenario agent.Scenario) []string {
	definitions := scenario.Tools.Definitions()
	names := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		names = append(names, definition.Name)
	}
	return names
}
