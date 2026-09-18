import type { AgentCompactionResult, AgentCompactionState } from '@manifold/contracts'

export type AgentNotice = {
  id: string
  kind: 'compaction'
  status: 'running' | 'complete' | 'error'
  compacted?: boolean
  compaction?: AgentCompactionState
}

export function createCompactionNotice(id: string): AgentNotice {
  return { id, kind: 'compaction', status: 'running' }
}

export function finishCompactionNotice(notice: AgentNotice, result: AgentCompactionResult): AgentNotice {
  return { ...notice, status: 'complete', compacted: result.compacted, compaction: result.compaction }
}

export function failCompactionNotice(notice: AgentNotice): AgentNotice {
  return { ...notice, status: 'error' }
}

export function restoreCompactionNotice(id: string, compaction: AgentCompactionState): AgentNotice {
  return { id, kind: 'compaction', status: 'complete', compacted: true, compaction }
}
