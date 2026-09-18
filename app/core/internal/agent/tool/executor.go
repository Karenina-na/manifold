package tool

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var ErrEffectNotAllowed = errors.New("tool effect is not allowed")

type Executor struct {
	registry *Registry
}

func NewExecutor(registry *Registry) *Executor {
	if registry == nil {
		registry = NewRegistry()
	}
	return &Executor{registry: registry}
}

func (executor *Executor) Execute(ctx context.Context, calls []ToolCall) []ToolResult {
	results := make([]ToolResult, len(calls))
	var group sync.WaitGroup
	for index := range calls {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			results[index] = executor.execute(ctx, calls[index])
		}(index)
	}
	group.Wait()
	return results
}

func (executor *Executor) execute(ctx context.Context, call ToolCall) ToolResult {
	result := ToolResult{CallID: call.ID, Name: call.Name}
	if err := ctx.Err(); err != nil {
		result.Err = err
		return result
	}
	registered, err := executor.registry.resolve(call.Name)
	if err != nil {
		result.Err = err
		return result
	}
	if registered.definition.Effect != ToolEffectReadOnly && registered.definition.Effect != ToolEffectSessionWrite {
		result.Err = fmt.Errorf("%w: tool %q has effect %q", ErrEffectNotAllowed, call.Name, registered.definition.Effect)
		return result
	}
	result.Output, result.Err = registered.tool.Execute(ctx, call.Arguments)
	return result
}
