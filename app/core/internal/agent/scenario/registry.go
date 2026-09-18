package scenario

import (
	"errors"
	"fmt"
)

var ErrNotRegistered = errors.New("agent dependency is not registered")

type Registry struct {
	factories map[string]Factory
}

func NewRegistry() *Registry {
	return &Registry{factories: map[string]Factory{}}
}

func (r *Registry) Register(name string, factory Factory) error {
	if name == "" || factory == nil {
		return errors.New("scenario name and factory are required")
	}
	if _, exists := r.factories[name]; exists {
		return fmt.Errorf("scenario %q is already registered", name)
	}
	r.factories[name] = factory
	return nil
}

func (r *Registry) Build(name string) (Scenario, error) {
	factory, ok := r.factories[name]
	if !ok {
		return Scenario{}, fmt.Errorf("%w: scenario %q", ErrNotRegistered, name)
	}
	configured, err := factory()
	if err != nil {
		return Scenario{}, err
	}
	if configured.Tools == nil {
		return Scenario{}, fmt.Errorf("scenario %q has no tool registry", name)
	}
	return configured, nil
}
