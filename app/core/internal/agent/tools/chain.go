package tools

import (
	"context"
	"encoding/json"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/chain"
)

type ChainReader interface {
	ChainInfo(ctx context.Context) (chain.ChainInfoResult, error)
}

type ChainStatus struct{ Ledger ChainReader }

func (ChainStatus) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "get_chain_status", Description: "Get the current read-only anchoring-chain height, tip and anchor counts.", Usage: "Use for current read-only anchoring-chain height, tip, or anchor-count facts; it does not submit or mutate chain state.", Parameters: json.RawMessage(`{"type":"object","properties":{},"required":[],"additionalProperties":false}`)}
}

func (tool ChainStatus) Execute(ctx context.Context, _ json.RawMessage) (any, error) {
	info, err := tool.Ledger.ChainInfo(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"height": info.Height, "totalAnchors": info.TotalAnchors, "pendingAnchors": info.PendingAnchors, "proofMode": info.ProofMode, "difficulty": info.Difficulty, "genesisHash": info.GenesisHash, "tipHash": info.TipHash, "sitePublicKey": info.SitePublicKey}, nil
}
