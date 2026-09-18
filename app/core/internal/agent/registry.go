package agent

import (
	"errors"
	"fmt"
	"sync"
)

var ErrNotRegistered = errors.New("agent dependency is not registered")

type ProviderRegistry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{providers: map[string]Provider{}}
}

func (r *ProviderRegistry) Register(name string, provider Provider) error {
	if name == "" || provider == nil {
		return errors.New("provider name and implementation are required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.providers[name]; exists {
		return fmt.Errorf("provider %q is already registered", name)
	}
	r.providers[name] = provider
	return nil
}

func (r *ProviderRegistry) Get(name string) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	provider, ok := r.providers[name]
	if !ok {
		return nil, fmt.Errorf("%w: provider %q", ErrNotRegistered, name)
	}
	return provider, nil
}
