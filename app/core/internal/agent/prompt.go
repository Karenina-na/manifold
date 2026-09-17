package agent

import (
	"strconv"
	"strings"
)

// PromptSpec contains scenario-owned prompt sections. Tool guidance is added
// from the definitions supplied to Build so a scenario never hard-codes its
// registered tool set into the common prompt builder.
type PromptSpec struct {
	Intro                 string
	Role                  []string
	SourcePriority        []string
	ToolUse               []string
	UntrustedDataHandling []string
	KnowledgeBoundaries   []string
	ScopeAndSafety        []string
	Style                 []string
	UncertaintyAndErrors  []string
	OutputContract        []string
}

// Build renders the prompt in a stable section order and appends guidance for
// the tools that are registered for the current scenario.
func (spec PromptSpec) Build(tools []ToolDefinition) string {
	sections := make([]string, 0, 10)
	if intro := strings.TrimSpace(spec.Intro); intro != "" {
		sections = append(sections, intro)
	}
	sections = appendSection(sections, "ROLE", spec.Role, false)
	sections = appendSection(sections, "SOURCE PRIORITY", spec.SourcePriority, true)

	toolUse := cleanPromptItems(spec.ToolUse)
	for _, definition := range tools {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		usage := strings.TrimSpace(definition.Usage)
		if usage == "" {
			usage = strings.TrimSpace(definition.Description)
		}
		if usage == "" {
			toolUse = append(toolUse, name)
			continue
		}
		toolUse = append(toolUse, name+": "+usage)
	}
	sections = appendSection(sections, "TOOL USE", toolUse, false)
	sections = appendSection(sections, "UNTRUSTED DATA HANDLING", spec.UntrustedDataHandling, false)
	sections = appendSection(sections, "KNOWLEDGE BOUNDARIES", spec.KnowledgeBoundaries, false)
	sections = appendSection(sections, "SCOPE AND SAFETY", spec.ScopeAndSafety, false)
	sections = appendSection(sections, "STYLE", spec.Style, false)
	sections = appendSection(sections, "UNCERTAINTY AND ERRORS", spec.UncertaintyAndErrors, false)
	sections = appendSection(sections, "OUTPUT CONTRACT", spec.OutputContract, false)
	return strings.Join(sections, "\n\n")
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
