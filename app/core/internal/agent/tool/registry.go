package tool

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

var ErrNotRegistered = errors.New("tool is not registered")

type Registry struct {
	mu    sync.RWMutex
	tools map[string]registeredTool
}

type registeredTool struct {
	tool       Tool
	definition ToolDefinition
}

func NewRegistry() *Registry {
	return &Registry{tools: map[string]registeredTool{}}
}

func (registry *Registry) Register(tool Tool) error {
	if tool == nil {
		return errors.New("tool is required")
	}
	definition := cloneDefinition(tool.Definition())
	name := strings.TrimSpace(definition.Name)
	if name == "" {
		return errors.New("tool name is required")
	}
	definition.Name = name
	if strings.TrimSpace(definition.Description) == "" {
		return fmt.Errorf("tool %q description is required", name)
	}
	if strings.TrimSpace(definition.Usage) == "" {
		return fmt.Errorf("tool %q usage is required", name)
	}
	if !definition.Effect.valid() {
		return fmt.Errorf("tool %q has invalid effect %q", name, definition.Effect)
	}
	if len(definition.Parameters) == 0 || !json.Valid(definition.Parameters) {
		return fmt.Errorf("tool %q parameters must be valid JSON", name)
	}

	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.tools == nil {
		registry.tools = map[string]registeredTool{}
	}
	if _, exists := registry.tools[name]; exists {
		return fmt.Errorf("tool %q is already registered", name)
	}
	registry.tools[name] = registeredTool{tool: tool, definition: definition}
	return nil
}

func (registry *Registry) Definitions() []ToolDefinition {
	registry.mu.RLock()
	defer registry.mu.RUnlock()
	names := make([]string, 0, len(registry.tools))
	for name := range registry.tools {
		names = append(names, name)
	}
	sort.Strings(names)
	definitions := make([]ToolDefinition, 0, len(names))
	for _, name := range names {
		definitions = append(definitions, cloneDefinition(registry.tools[name].definition))
	}
	return definitions
}

func (registry *Registry) resolve(name string) (registeredTool, error) {
	registry.mu.RLock()
	defer registry.mu.RUnlock()
	registered, ok := registry.tools[name]
	if !ok {
		return registeredTool{}, fmt.Errorf("%w: tool %q", ErrNotRegistered, name)
	}
	return registered, nil
}
