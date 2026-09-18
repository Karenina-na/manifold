package prompt

import (
	"fmt"
	"strconv"
	"strings"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

// Build renders the prompt in a stable section order and appends guidance for
// the tools that are registered for the current scenario.
func Build(spec Spec, tools []agenttool.ToolDefinition) string {
	sections := make([]string, 0, 10)
	if intro := strings.TrimSpace(spec.Intro); intro != "" {
		sections = append(sections, intro)
	}
	sections = appendSection(sections, "ROLE", spec.Role, false)
	sections = appendSection(sections, "INSTRUCTION SCOPE", spec.InstructionScope, false)
	sections = appendSection(sections, "SOURCE PRIORITY", spec.SourcePriority, true)

	toolUse := cleanPromptItems(spec.ToolUse)
	for _, definition := range tools {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		usage := strings.TrimSpace(definition.Usage)
		if usage == "" {
			toolUse = append(toolUse, name)
			continue
		}
		toolUse = append(toolUse, name+": "+usage)
	}
	sections = appendSection(sections, "TOOL USE", toolUse, false)
	sections = appendCapabilitySection(sections, tools)
	sections = appendSection(sections, "UNTRUSTED DATA HANDLING", spec.UntrustedDataHandling, false)
	sections = appendSection(sections, "KNOWLEDGE BOUNDARIES", spec.KnowledgeBoundaries, false)
	sections = appendSection(sections, "SCOPE AND SAFETY", spec.ScopeAndSafety, false)
	sections = appendSection(sections, "STYLE", spec.Style, false)
	sections = appendSection(sections, "UNCERTAINTY AND ERRORS", spec.UncertaintyAndErrors, false)
	sections = appendSection(sections, "OUTPUT CONTRACT", spec.OutputContract, false)
	return strings.Join(sections, "\n\n")
}

func appendCapabilitySection(sections []string, tools []agenttool.ToolDefinition) []string {
	if len(sections) == 0 && len(tools) == 0 {
		return sections
	}
	lines := []string{
		"CAPABILITY BOUNDARIES",
		"- Only registered tools are available for this run.",
	}
	registered := 0
	for _, definition := range tools {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		registered++
		lines = append(lines, "- "+capabilityStatement(name, definition.Effect))
	}
	if registered == 0 {
		lines = append(lines, "- No tools are registered for this run.")
	}
	return append(sections, strings.Join(lines, "\n"))
}

func capabilityStatement(name string, effect agenttool.ToolEffect) string {
	switch effect {
	case agenttool.ToolEffectReadOnly:
		return fmt.Sprintf("%s is read-only.", name)
	case agenttool.ToolEffectWrite:
		return fmt.Sprintf("%s changes persistent state and is unavailable without an explicit runtime grant.", name)
	case agenttool.ToolEffectDestructive:
		return fmt.Sprintf("%s can delete or irreversibly change state and is unavailable without an explicit runtime grant and confirmation.", name)
	default:
		return fmt.Sprintf("%s has an unspecified effect and must not be used.", name)
	}
}

func appendSection(sections []string, title string, items []string, ordered bool) []string {
	items = cleanPromptItems(items)
	if len(items) == 0 {
		return sections
	}
	lines := make([]string, 0, len(items)+1)
	lines = append(lines, title)
	for index, item := range items {
		prefix := "- "
		if ordered {
			prefix = strconv.Itoa(index+1) + ". "
		}
		lines = append(lines, prefix+item)
	}
	return append(sections, strings.Join(lines, "\n"))
}

func cleanPromptItems(items []string) []string {
	cleaned := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			cleaned = append(cleaned, item)
		}
	}
	return cleaned
}
