package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

type RuntimeConfig struct {
	Provider        string
	Model           string
	MaxToolRounds   int
	HistoryLimit    int
	MaxOutputTokens int
}

type Runtime struct {
	config    RuntimeConfig
	providers *ProviderRegistry
	tools     *agenttool.Registry
	executor  *agenttool.Executor
	messages  SessionMessageRepository
	context   *ContextBuilder
	sequence  atomic.Uint64
}

func NewRuntime(config RuntimeConfig, providers *ProviderRegistry, scenario Scenario, messages SessionMessageRepository) *Runtime {
	if config.MaxToolRounds < 1 {
		config.MaxToolRounds = 6
	}
	if config.HistoryLimit < 1 {
		config.HistoryLimit = 40
	}
	if scenario.Tools == nil {
		scenario.Tools = agenttool.NewRegistry()
	}
	return &Runtime{config: config, providers: providers, tools: scenario.Tools, executor: agenttool.NewExecutor(scenario.Tools), messages: messages, context: NewContextBuilder(messages, scenario.Prompt, scenario.Tools, config.HistoryLimit)}
}

func (r *Runtime) Run(ctx context.Context, sessionID, userMessage string, emit func(StreamEvent) error) error {
	provider, err := r.providers.Get(r.config.Provider)
	if err != nil {
		return err
	}
	messages, err := r.context.Build(ctx, sessionID, userMessage)
	if err != nil {
		return err
	}
	persistedUser, err := r.messages.Append(ctx, sessionID, SessionMessage{Role: string(RoleUser), Content: userMessage})
	if err != nil {
		return err
	}

	runID := fmt.Sprintf("run_%d", r.sequence.Add(1))
	if err := emit(StreamEvent{Type: EventRunStarted, RunID: runID, MessageID: persistedUser.ID}); err != nil {
		return err
	}
	totalUsage := Usage{}
	traceSteps := make([]TraceStep, 0)
	for round := 0; round <= r.config.MaxToolRounds; round++ {
		reasoningID := fmt.Sprintf("%s-reasoning-%d", runID, round)
		reasoningIndex := len(traceSteps)
		traceSteps = append(traceSteps, TraceStep{ID: reasoningID, Kind: "reasoning", Status: "running"})
		if err := emit(StreamEvent{Type: EventReasoningStarted, RunID: runID}); err != nil {
			return err
		}
		response, err := provider.Chat(ctx, ChatRequest{Messages: messages, Tools: r.tools.Definitions(), Model: r.config.Model, Options: ChatOptions{MaxOutputTokens: r.config.MaxOutputTokens}})
		if err != nil {
			return err
		}
		if response == nil {
			return errors.New("provider returned no response")
		}
		if err := emit(StreamEvent{Type: EventReasoningCompleted, RunID: runID}); err != nil {
			return err
		}
		traceSteps[reasoningIndex].Status = "complete"
		totalUsage.InputTokens += response.Usage.InputTokens
		totalUsage.OutputTokens += response.Usage.OutputTokens
		totalUsage.TotalTokens += response.Usage.TotalTokens

		if len(response.ToolCalls) == 0 {
			if response.Content != "" {
				if err := emit(StreamEvent{Type: EventContentDelta, Delta: response.Content}); err != nil {
					return err
				}
				if _, err := r.messages.Append(ctx, sessionID, SessionMessage{
					Role:    string(RoleAssistant),
					Content: response.Content,
					Trace: &MessageTrace{
						Steps:        append([]TraceStep(nil), traceSteps...),
						FinishReason: string(response.FinishReason),
						Usage: TraceUsage{
							InputTokens:  totalUsage.InputTokens,
							OutputTokens: totalUsage.OutputTokens,
							TotalTokens:  totalUsage.TotalTokens,
						},
					},
				}); err != nil {
					return err
				}
			}
			usage := totalUsage
			return emit(StreamEvent{Type: EventRunCompleted, RunID: runID, FinishReason: response.FinishReason, Usage: &usage})
		}
		if round == r.config.MaxToolRounds {
			return fmt.Errorf("tool round limit reached")
		}

		messages = append(messages, Message{Role: RoleAssistant, Content: response.Content, ToolCalls: response.ToolCalls, ProviderContext: response.ProviderContext})
		toolIndexes := make([]int, len(response.ToolCalls))
		for index, call := range response.ToolCalls {
			var input any
			if err := json.Unmarshal(call.Arguments, &input); err != nil {
				input = string(call.Arguments)
			}
			toolIndex := len(traceSteps)
			toolIndexes[index] = toolIndex
			traceSteps = append(traceSteps, TraceStep{ID: call.ID, Kind: "tool", Name: call.Name, Input: input, Status: "running"})
			if err := emit(StreamEvent{Type: EventToolStarted, CallID: call.ID, Name: call.Name, Input: input}); err != nil {
				return err
			}
		}
		for index, result := range r.executor.Execute(ctx, response.ToolCalls) {
			output := result.Output
			if result.Err != nil {
				output = map[string]string{"error": result.Err.Error()}
			}
			isError := result.Err != nil
			toolIndex := toolIndexes[index]
			traceSteps[toolIndex].Output = output
			traceSteps[toolIndex].Status = "complete"
			if isError {
				traceSteps[toolIndex].Status = "error"
			}
			if err := emit(StreamEvent{Type: EventToolCompleted, CallID: result.CallID, Name: result.Name, Output: output, IsError: &isError}); err != nil {
				return err
			}
			raw, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				return marshalErr
			}
			messages = append(messages, Message{Role: RoleTool, Content: string(raw), ToolCallID: result.CallID})
		}
	}
	return errors.New("agent run did not complete")
}
