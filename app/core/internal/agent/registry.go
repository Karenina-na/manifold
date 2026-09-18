package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

var (
	ErrNotRegistered        = errors.New("agent dependency is not registered")
	ErrToolEffectNotAllowed = errors.New("tool effect is not allowed")
)

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

type Tool interface {
	Definition() ToolDefinition
	Execute(ctx context.Context, arguments json.RawMessage) (any, error)
}

type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]registeredTool
}

type registeredTool struct {
	tool       Tool
	definition ToolDefinition
}

func NewToolRegistry() *ToolRegistry { return &ToolRegistry{tools: map[string]registeredTool{}} }

func (r *ToolRegistry) Register(tool Tool) error {
	if tool == nil {
		return errors.New("tool is required")
	}
	definition := tool.Definition()
	name := definition.Name
	if name == "" {
		return errors.New("tool name is required")
	}
	if strings.TrimSpace(definition.Description) == "" {
		return fmt.Errorf("tool %q description is required", name)
	}
	if strings.TrimSpace(definition.Usage) == "" {
		return fmt.Errorf("tool %q usage is required", name)
	}
	if !definition.Effect.valid() {
		return fmt.Errorf("tool %q has invalid effect %q", name, definition.Effect)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.tools[name]; exists {
		return fmt.Errorf("tool %q is already registered", name)
	}
	r.tools[name] = registeredTool{tool: tool, definition: definition}
	return nil
}

func (r *ToolRegistry) Definitions() []ToolDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	sort.Strings(names)
	definitions := make([]ToolDefinition, 0, len(names))
	for _, name := range names {
		definitions = append(definitions, r.tools[name].definition)
	}
	return definitions
}

func (r *ToolRegistry) Execute(ctx context.Context, call ToolCall) (any, error) {
	r.mu.RLock()
	entry, ok := r.tools[call.Name]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: tool %q", ErrNotRegistered, call.Name)
	}
	if entry.definition.Effect != ToolEffectReadOnly {
		return nil, fmt.Errorf("%w: tool %q has effect %q", ErrToolEffectNotAllowed, call.Name, entry.definition.Effect)
	}
	return entry.tool.Execute(ctx, call.Arguments)
}
