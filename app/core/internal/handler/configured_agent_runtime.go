package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	agentmemory "github.com/manifold-space/manifold/app/core/internal/agent/memory"
	agentprovider "github.com/manifold-space/manifold/app/core/internal/agent/provider"
	"github.com/manifold-space/manifold/app/core/internal/agent/provider/openai"
	agentruntime "github.com/manifold-space/manifold/app/core/internal/agent/runtime"
	agentscenario "github.com/manifold-space/manifold/app/core/internal/agent/scenario"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type configuredAgentRuntime struct {
	store    *store.Store
	scenario agentscenario.Scenario
	history  agentconversation.History
	memory   agentmemory.Store

	mu           sync.Mutex
	cached       *agentruntime.Runtime
	cachedValue  model.AgentSettings
	sessionLocks sync.Map
}

func newConfiguredAgentRuntime(database *store.Store, scenario agentscenario.Scenario, history agentconversation.History, memory agentmemory.Store) *configuredAgentRuntime {
	return &configuredAgentRuntime{store: database, scenario: scenario, history: history, memory: memory}
}

func (r *configuredAgentRuntime) Ready(ctx context.Context) error {
	settings, err := r.store.GetAgentSettings(ctx)
	if err != nil {
		return err
	}
	return validateRunnableAgentSettings(settings)
}

func (r *configuredAgentRuntime) Run(ctx context.Context, sessionID, userMessage string, emit func(agentruntime.StreamEvent) error) error {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	settings, err := r.store.GetAgentSettings(ctx)
	if err != nil {
		return err
	}
	if err := validateRunnableAgentSettings(settings); err != nil {
		return err
	}
	runtime, err := r.runtime(settings)
	if err != nil {
		return err
	}
	return runtime.Run(ctx, sessionID, userMessage, emit)
}

func (r *configuredAgentRuntime) List(ctx context.Context, sessionID string, limit int) ([]agentconversation.Message, error) {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.history.List(ctx, sessionID, limit)
}

func (r *configuredAgentRuntime) Clear(ctx context.Context, sessionID string) error {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.history.Clear(ctx, sessionID)
}

func (r *configuredAgentRuntime) CloseSession(ctx context.Context, sessionID string) error {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	var memoryErr error
	if r.memory != nil {
		memoryErr = r.memory.Clear(ctx, sessionID)
	}
	return errors.Join(r.history.Clear(ctx, sessionID), memoryErr)
}

func (r *configuredAgentRuntime) Undo(ctx context.Context, sessionID, messageID string) (agentconversation.Message, []agentconversation.Message, error) {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.history.Undo(ctx, sessionID, messageID)
}

func (r *configuredAgentRuntime) sessionLock(sessionID string) *sync.Mutex {
	value, _ := r.sessionLocks.LoadOrStore(sessionID, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func (r *configuredAgentRuntime) runtime(settings model.AgentSettings) (*agentruntime.Runtime, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cached != nil && r.cachedValue == settings {
		return r.cached, nil
	}

	providerRegistry := agentprovider.NewRegistry()
	switch settings.Provider {
	case "openai":
		if err := providerRegistry.Register("openai", openai.New(settings.OpenAIAPIKey, settings.OpenAIBaseURL, &http.Client{Timeout: 60 * time.Second})); err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported agent provider")
	}
	r.cached = agentruntime.NewRuntime(agentruntime.RuntimeConfig{Provider: settings.Provider, Model: settings.Model, MaxToolRounds: settings.MaxToolRounds, HistoryLimit: settings.HistoryLimit, MaxOutputTokens: settings.MaxOutputTokens}, providerRegistry, r.scenario, r.history)
	r.cachedValue = settings
	return r.cached, nil
}

func validateRunnableAgentSettings(settings model.AgentSettings) error {
	if settings.Provider != "openai" || strings.TrimSpace(settings.Model) == "" || strings.TrimSpace(settings.OpenAIAPIKey) == "" || strings.TrimSpace(settings.OpenAIBaseURL) == "" {
		return errors.New("agent provider is not configured")
	}
	return nil
}
