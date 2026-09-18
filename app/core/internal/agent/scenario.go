package agent

import (
	"errors"
	"fmt"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type Scenario struct {
	Prompt PromptSpec
	Tools  *agenttool.Registry
}

type ScenarioFactory func() (Scenario, error)

type ScenarioRegistry struct {
	factories map[string]ScenarioFactory
}

func NewScenarioRegistry() *ScenarioRegistry {
	return &ScenarioRegistry{factories: map[string]ScenarioFactory{}}
}

func (r *ScenarioRegistry) Register(name string, factory ScenarioFactory) error {
	if name == "" || factory == nil {
		return errors.New("scenario name and factory are required")
	}
	if _, exists := r.factories[name]; exists {
		return fmt.Errorf("scenario %q is already registered", name)
	}
	r.factories[name] = factory
	return nil
}

func (r *ScenarioRegistry) Build(name string) (Scenario, error) {
	factory, ok := r.factories[name]
	if !ok {
		return Scenario{}, fmt.Errorf("%w: scenario %q", ErrNotRegistered, name)
	}
	scenario, err := factory()
	if err != nil {
		return Scenario{}, err
	}
	if scenario.Tools == nil {
		return Scenario{}, fmt.Errorf("scenario %q has no tool registry", name)
	}
	return scenario, nil
}
