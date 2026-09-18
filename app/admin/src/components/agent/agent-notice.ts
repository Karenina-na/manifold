export type AgentNotice = {
  id: string
  kind: 'compaction'
  status: 'running' | 'complete' | 'error'
  compacted?: boolean
}

export function createCompactionNotice(id: string): AgentNotice {
  return { id, kind: 'compaction', status: 'running' }
}

export function finishCompactionNotice(notice: AgentNotice, compacted: boolean): AgentNotice {
  return { ...notice, status: 'complete', compacted }
}

export function failCompactionNotice(notice: AgentNotice): AgentNotice {
  return { ...notice, status: 'error' }
}
