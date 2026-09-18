package compact

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"

	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
)

const maxToolResultBytes = 2048

type CleanMessage struct {
	Role    string      `json:"role"`
	Content string      `json:"content,omitempty"`
	Tools   []CleanTool `json:"tools,omitempty"`
}

type CleanTool struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Input  any    `json:"input,omitempty"`
	Output any    `json:"output,omitempty"`
}

func Normalize(messages []agentconversation.Message) []CleanMessage {
	clean := make([]CleanMessage, 0, len(messages))
	for index, message := range messages {
		item := CleanMessage{Role: message.Role, Content: message.Content}
		if message.Trace != nil {
			item.Tools = pruneUnreferencedFailures(normalizeTools(message.Trace.Steps), messages[index:])
		}
		clean = append(clean, item)
	}
	return clean
}

type toolCandidate struct {
	tool CleanTool
	keep bool
}

func normalizeTools(steps []agentconversation.TraceStep) []CleanTool {
	var candidates []toolCandidate
	failuresByAttempt := map[string][]int{}
	lastExact := map[string]int{}
	for _, step := range steps {
		if step.Kind != "tool" {
			continue
		}
		inputKey := canonicalJSON(step.Input)
		outputKey := canonicalJSON(step.Output)
		attemptKey := step.Name + "\x00" + inputKey
		exactKey := attemptKey + "\x00" + step.Status + "\x00" + outputKey
		if previous, ok := lastExact[exactKey]; ok {
			candidates[previous].keep = false
		}
		if step.Status == "complete" {
			for _, previous := range failuresByAttempt[attemptKey] {
				candidates[previous].keep = false
			}
			delete(failuresByAttempt, attemptKey)
		}
		output := boundedToolResult(step.Output)
		if step.Status == "error" {
			output = conciseError(step.Output)
		}
		candidate := toolCandidate{keep: true, tool: CleanTool{ID: step.ID, Name: step.Name, Status: step.Status, Input: step.Input, Output: output}}
		candidates = append(candidates, candidate)
		index := len(candidates) - 1
		if step.Status == "error" {
			failuresByAttempt[attemptKey] = append(failuresByAttempt[attemptKey], index)
		}
		lastExact[exactKey] = index
	}

	tools := make([]CleanTool, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.keep {
			tools = append(tools, candidate.tool)
		}
	}
	return tools
}

func pruneUnreferencedFailures(tools []CleanTool, remaining []agentconversation.Message) []CleanTool {
	references := strings.ToLower(referenceText(remaining))
	result := make([]CleanTool, 0, len(tools))
	for _, tool := range tools {
		if tool.Status == "error" {
			errorText := strings.ToLower(extractError(tool.Output))
			idReferenced := tool.ID != "" && strings.Contains(references, strings.ToLower(tool.ID))
			if !idReferenced && (errorText == "" || !strings.Contains(references, errorText)) {
				continue
			}
		}
		result = append(result, tool)
	}
	return result
}

func referenceText(messages []agentconversation.Message) string {
	var parts []string
	for _, message := range messages {
		parts = append(parts, message.Content)
		if message.Trace == nil {
			continue
		}
		for _, step := range message.Trace.Steps {
			if step.Kind == "tool" {
				parts = append(parts, canonicalJSON(step.Input))
			}
		}
	}
	return strings.Join(parts, "\n")
}

func conciseError(value any) any {
	if text := extractError(value); text != "" {
		return map[string]string{"error": truncateRunes(text, 512)}
	}
	return boundedToolResult(value)
}

func extractError(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		if message, ok := typed["error"].(string); ok {
			return message
		}
	case map[string]string:
		return typed["error"]
	case string:
		return typed
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func canonicalJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%T:%v", value, value)
	}
	return string(raw)
}

func boundedToolResult(value any) any {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) <= maxToolResultBytes {
		return value
	}
	metadata := map[string]any{
		"truncated": true,
		"bytes":     len(raw),
		"type":      reflect.TypeOf(value).String(),
	}
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		metadata["keys"] = keys
	case []any:
		metadata["items"] = len(typed)
	case string:
		metadata["characters"] = len([]rune(typed))
	}
	return metadata
}
