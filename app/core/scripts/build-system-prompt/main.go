package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	agentruntime "github.com/manifold-space/manifold/app/core/internal/agent/runtime"
	agentscenario "github.com/manifold-space/manifold/app/core/internal/agent/scenario"
	"github.com/manifold-space/manifold/app/core/internal/agent/scenario/manifold"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/seed"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	ctx := context.Background()
	database, err := store.Open(ctx, ":memory:", store.WithSeedPlan(seed.Plan{}))
	if err != nil {
		return fmt.Errorf("open prompt preview database: %w", err)
	}
	defer database.Close()

	memory := agentmemory.NewInMemory()
	ledger := chain.NewLedger(database.DB, chain.LedgerConfig{ProofMode: chain.ProofModeSim})
	scenarios := agentscenario.NewRegistry()
	if err := manifold.Register(scenarios, manifold.Dependencies{
		Profile:      database,
		Content:      database,
		Chain:        ledger,
		ChainAnchors: ledger,
		Memory:       memory,
	}); err != nil {
		return fmt.Errorf("register Manifold scenario: %w", err)
	}
	scenario, err := scenarios.Build(manifold.Name)
	if err != nil {
		return fmt.Errorf("build Manifold scenario: %w", err)
	}

	runtime := agentruntime.NewRuntime(
		agentruntime.RuntimeConfig{HistoryLimit: 40},
		agentprovider.NewRegistry(),
		scenario,
		agentconversation.NewVolatileHistory(),
	)
	userMessage := "Preview the current Manifold assistant context."
	if message := strings.TrimSpace(strings.Join(args, " ")); message != "" {
		userMessage = message
	}
	messages, err := runtime.BuildContext(ctx, "prompt-preview", userMessage)
	if err != nil {
		return fmt.Errorf("build runtime context: %w", err)
	}
	for _, message := range messages {
		fmt.Printf("[%s]\n%s\n\n", message.Role, message.Content)
	}
	return nil
}
