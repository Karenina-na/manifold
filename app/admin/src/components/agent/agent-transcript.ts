import type { AgentFinishReason, AgentMessage, AgentStreamEvent, AgentTraceStep, AgentUsage } from '@manifold/contracts'
import type { AgentNotice } from './agent-notice'

const maxPayloadChars = 12000

export type AgentProcessItem = AgentTraceStep

export type AgentTurn = {
  id: string
  user?: AgentMessage
  assistant?: AgentMessage
  process: AgentProcessItem[]
  status: 'idle' | 'running' | 'complete' | 'error'
  finishReason?: AgentFinishReason
  usage?: AgentUsage
  persisted: boolean
}

export type AgentTranscriptItem =
  | { kind: 'turn'; turn: AgentTurn }
  | { kind: 'compaction'; notice: AgentNotice }

export function buildAgentTranscript(turns: AgentTurn[], notice: AgentNotice | null): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = turns.map((turn) => ({ kind: 'turn', turn }))
  if (!notice) return items
  const anchorIndex = notice.afterMessageID
    ? turns.findIndex((turn) => turn.user?.id === notice.afterMessageID || turn.assistant?.id === notice.afterMessageID)
    : -1
  const insertAt = anchorIndex < 0 ? items.length : anchorIndex + 1
  items.splice(insertAt, 0, { kind: 'compaction', notice })
  return items
}

function persistedTrace(message: AgentMessage) {
  if (!message.trace) return { process: [] as AgentProcessItem[] }
  return { process: [...message.trace.steps], finishReason: message.trace.finishReason, usage: message.trace.usage }
}

export function groupAgentMessages(messages: AgentMessage[]): AgentTurn[] {
  const turns: AgentTurn[] = []
  for (const message of messages) {
    const current = turns.at(-1)
    if (message.role === 'user' || !current || current.assistant) {
      turns.push({ id: message.id, user: message.role === 'user' ? message : undefined, assistant: message.role === 'assistant' ? message : undefined, ...persistedTrace(message), status: message.role === 'user' ? 'error' : 'complete', persisted: true })
      continue
    }
    current.assistant = message
    Object.assign(current, persistedTrace(message))
    current.status = 'complete'
  }
  return turns
}

export function applyAgentEvent(turn: AgentTurn, event: AgentStreamEvent): AgentTurn {
  if (event.type === 'run.started') return { ...turn, status: 'running', persisted: true, user: turn.user ? { ...turn.user, id: event.messageId } : turn.user }
  if (event.type === 'reasoning.started') return { ...turn, status: 'running', process: [...turn.process, { id: `${event.runId}-reasoning-${turn.process.length}`, kind: 'reasoning', status: 'running' }] }
  if (event.type === 'reasoning.completed') {
    const last = [...turn.process].reverse().findIndex((item) => item.kind === 'reasoning' && item.status === 'running')
    const index = last < 0 ? -1 : turn.process.length - 1 - last
    return index < 0 ? turn : { ...turn, process: turn.process.map((item, itemIndex) => itemIndex === index ? { ...item, status: 'complete', ...(event.message ? { message: event.message } : {}) } : item) }
  }
  if (event.type === 'tool.started') return { ...turn, status: 'running', process: [...turn.process, { id: event.callId, kind: 'tool', name: event.name, input: event.input, status: 'running' }] }
  if (event.type === 'tool.completed') return { ...turn, process: turn.process.map((item) => item.kind === 'tool' && item.id === event.callId ? { ...item, output: event.output, status: event.isError ? 'error' : 'complete' } : item) }
  if (event.type === 'content.delta' && turn.assistant) return { ...turn, assistant: { ...turn.assistant, content: turn.assistant.content + event.delta } }
  if (event.type === 'run.completed') return { ...turn, status: event.finishReason === 'error' ? 'error' : 'complete', finishReason: event.finishReason, usage: event.usage }
  if (event.type === 'run.error') return { ...turn, status: 'error', finishReason: 'error', process: [...turn.process, { id: `${event.runId}-error`, kind: 'error', message: event.message }] }
  return turn
}

export function formatAgentPayload(value: unknown) {
  if (value === undefined) return '—'
  let formatted: string
  if (typeof value === 'string') {
    formatted = value
  } else {
    try {
      formatted = JSON.stringify(value, null, 2) ?? '—'
    } catch {
      formatted = String(value)
    }
  }
  return formatted.length > maxPayloadChars ? `${formatted.slice(0, maxPayloadChars)}\n…` : formatted
}
