package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/providers"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type configuredAgentRuntime struct {
	store    *store.Store
	scenario agent.Scenario
	memory   agent.SessionMemory

	mu           sync.Mutex
	cached       *agent.Runtime
	cachedValue  model.AgentSettings
	sessionLocks sync.Map
}

func newConfiguredAgentRuntime(database *store.Store, scenario agent.Scenario, memory agent.SessionMemory) *configuredAgentRuntime {
	return &configuredAgentRuntime{store: database, scenario: scenario, memory: memory}
}

func (r *configuredAgentRuntime) Ready(ctx context.Context) error {
	settings, err := r.store.GetAgentSettings(ctx)
	if err != nil {
		return err
	}
	return validateRunnableAgentSettings(settings)
}

func (r *configuredAgentRuntime) Run(ctx context.Context, sessionID, userMessage string, emit func(agent.StreamEvent) error) error {
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

func (r *configuredAgentRuntime) List(ctx context.Context, sessionID string, limit int) ([]agent.SessionMessage, error) {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.memory.List(ctx, sessionID, limit)
}

func (r *configuredAgentRuntime) Clear(ctx context.Context, sessionID string) error {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.memory.Delete(ctx, sessionID)
}

func (r *configuredAgentRuntime) Undo(ctx context.Context, sessionID, messageID string) (agent.SessionMessage, []agent.SessionMessage, error) {
	lock := r.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	return r.memory.UndoTurn(ctx, sessionID, messageID)
}

func (r *configuredAgentRuntime) sessionLock(sessionID string) *sync.Mutex {
	value, _ := r.sessionLocks.LoadOrStore(sessionID, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func (r *configuredAgentRuntime) runtime(settings model.AgentSettings) (*agent.Runtime, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cached != nil && r.cachedValue == settings {
		return r.cached, nil
	}

	providerRegistry := agent.NewProviderRegistry()
	switch settings.Provider {
	case "openai":
		if err := providerRegistry.Register("openai", providers.NewOpenAI(settings.OpenAIAPIKey, settings.OpenAIBaseURL, &http.Client{Timeout: 60 * time.Second})); err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported agent provider")
	}
	r.cached = agent.NewRuntime(agent.RuntimeConfig{Provider: settings.Provider, Model: settings.Model, MaxToolRounds: settings.MaxToolRounds, HistoryLimit: settings.HistoryLimit, MaxOutputTokens: settings.MaxOutputTokens}, providerRegistry, r.scenario, r.memory)
	r.cachedValue = settings
	return r.cached, nil
}

func validateRunnableAgentSettings(settings model.AgentSettings) error {
	if settings.Provider != "openai" || strings.TrimSpace(settings.Model) == "" || strings.TrimSpace(settings.OpenAIAPIKey) == "" || strings.TrimSpace(settings.OpenAIBaseURL) == "" {
		return errors.New("agent provider is not configured")
	}
	return nil
}
