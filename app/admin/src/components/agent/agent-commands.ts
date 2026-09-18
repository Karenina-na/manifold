export type AgentCommandID = 'compact' | 'quit' | 'clear'

export type AgentCommand = {
  id: AgentCommandID
  name: `/${AgentCommandID}`
}

export const agentCommands: readonly AgentCommand[] = [
  { id: 'compact', name: '/compact' },
  { id: 'quit', name: '/quit' },
  { id: 'clear', name: '/clear' },
]

export function completeAgentCommands(value: string): AgentCommand[] {
  if (!value.startsWith('/') || /\s/.test(value)) return []
  const prefix = value.toLowerCase()
  return agentCommands.filter((command) => command.name.startsWith(prefix))
}

export function parseAgentCommand(value: string): AgentCommandID | undefined {
  const normalized = value.trim().toLowerCase()
  return agentCommands.find((command) => command.name === normalized)?.id
}
