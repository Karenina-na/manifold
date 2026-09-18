package prompt

import (
	"strconv"
	"strings"

	agenttool "github.com/manifold-space/manifold/app/core/internal/agent/tool"
)

// Build renders scenario-owned prompt sections and then projects the
// registered tool metadata into separate runtime-owned sections.
func Build(spec Spec, tools []agenttool.ToolDefinition) string {
	sections := make([]string, 0, 14)
	if intro := strings.TrimSpace(spec.Intro); intro != "" {
		sections = append(sections, intro)
	}
	sections = appendSection(sections, "ROLE", spec.Role, false)
	sections = appendSection(sections, "INSTRUCTION SCOPE", spec.InstructionScope, false)
	sections = appendSection(sections, "SCOPE AND SAFETY", spec.ScopeAndSafety, false)
	sections = appendSection(sections, "UNTRUSTED DATA HANDLING", spec.UntrustedDataHandling, false)
	sections = appendSection(sections, "SOURCE PRIORITY", spec.SourcePriority, true)
	sections = appendSection(sections, "KNOWLEDGE BOUNDARIES", spec.KnowledgeBoundaries, false)
	sections = appendSection(sections, "TOOL USE", spec.ToolUse, false)
	sections = appendSection(sections, "MEMORY USE", spec.MemoryUse, false)
	sections = appendToolSection(sections, tools)
	sections = appendCapabilitySection(sections, tools)
	sections = appendSection(sections, "STYLE", spec.Style, false)
	sections = appendSection(sections, "UNCERTAINTY AND ERRORS", spec.UncertaintyAndErrors, false)
	sections = appendSection(sections, "OUTPUT CONTRACT", spec.OutputContract, false)
	return strings.Join(sections, "\n\n")
}

func appendToolSection(sections []string, tools []agenttool.ToolDefinition) []string {
	lines := []string{
		"AVAILABLE TOOLS",
		"- The following registered tools are available for this run.",
	}
	registered := 0
	for _, definition := range tools {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		registered++
		description := strings.TrimSpace(definition.Description)
		entry := "- " + name + " [" + effectLabel(definition.Effect) + "]"
		if description != "" {
			entry += ": " + description
		}
		if usage := strings.TrimSpace(definition.Usage); usage != "" {
			entry += "\n  Guidance: " + usage
		}
		lines = append(lines, entry)
	}
	if registered == 0 {
		return sections
	}
	return append(sections, strings.Join(lines, "\n"))
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
	requiresGrant := false
	for _, definition := range tools {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		registered++
		if definition.Effect == agenttool.ToolEffectWrite || definition.Effect == agenttool.ToolEffectDestructive {
			requiresGrant = true
		}
	}
	if registered == 0 {
		lines = append(lines, "- No tools are registered for this run.")
		return append(sections, strings.Join(lines, "\n"))
	}
	lines = append(lines,
		"- Each tool may act only within its declared effect and scope.",
		"- A tool's existence does not grant capabilities beyond its declared effect.",
		"- Read-only tools do not change state; session-write tools may change only temporary state bound to the current session.",
	)
	if requiresGrant {
		lines = append(lines, "- Persistent-write and destructive tools are unavailable without an explicit runtime grant; destructive operations also require confirmation.")
	}
	return append(sections, strings.Join(lines, "\n"))
}

func effectLabel(effect agenttool.ToolEffect) string {
	switch effect {
	case agenttool.ToolEffectReadOnly:
		return "read-only"
	case agenttool.ToolEffectSessionWrite:
		return "session-write"
	case agenttool.ToolEffectWrite:
		return "write"
	case agenttool.ToolEffectDestructive:
		return "destructive"
	default:
		return "unspecified"
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
