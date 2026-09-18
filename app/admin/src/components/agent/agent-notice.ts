import type { AgentCompactionResult, AgentCompactionState } from '@manifold/contracts'

export type AgentNotice = {
  id: string
  kind: 'compaction'
  status: 'running' | 'complete' | 'error'
  afterMessageID?: string
  compacted?: boolean
  compaction?: AgentCompactionState
}

export function createCompactionNotice(id: string, afterMessageID?: string): AgentNotice {
  return { id, kind: 'compaction', status: 'running', ...(afterMessageID ? { afterMessageID } : {}) }
}

export function finishCompactionNotice(notice: AgentNotice, result: AgentCompactionResult): AgentNotice {
  const afterMessageID = result.compaction.afterMessageId ?? notice.afterMessageID
  return { ...notice, status: 'complete', ...(afterMessageID ? { afterMessageID } : {}), compacted: result.compacted, compaction: result.compaction }
}

export function failCompactionNotice(notice: AgentNotice): AgentNotice {
  return { ...notice, status: 'error' }
}

export function restoreCompactionNotice(id: string, compaction: AgentCompactionState, fallbackAfterMessageID?: string): AgentNotice {
  const afterMessageID = compaction.afterMessageId ?? fallbackAfterMessageID
  return { id, kind: 'compaction', status: 'complete', ...(afterMessageID ? { afterMessageID } : {}), compacted: true, compaction }
}
