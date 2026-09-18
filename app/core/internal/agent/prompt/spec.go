package prompt

// Spec contains scenario-owned prompt sections. Tool guidance is supplied to
// Build so a scenario does not duplicate its registered capabilities.
type Spec struct {
	Intro string
	Role  []string

	InstructionScope      []string
	ScopeAndSafety        []string
	UntrustedDataHandling []string

	SourcePriority      []string
	KnowledgeBoundaries []string

	ToolUse   []string
	MemoryUse []string

	Style                []string
	UncertaintyAndErrors []string
	OutputContract       []string
}
