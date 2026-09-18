import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompactionNotice, failCompactionNotice, finishCompactionNotice, restoreCompactionNotice } from './agent-notice.ts'

test('tracks compaction progress from running to completed', () => {
  const running = createCompactionNotice('compact-1')
  assert.deepEqual(running, { id: 'compact-1', kind: 'compaction', status: 'running' })
  const result = { compacted: true, compaction: { summary: 'Working state', compactedMessages: 4, recentTurns: 2 } }
  assert.deepEqual(finishCompactionNotice(running, result), { id: 'compact-1', kind: 'compaction', status: 'complete', compacted: true, compaction: result.compaction })
  assert.deepEqual(finishCompactionNotice(running, { compacted: false, compaction: { summary: '', compactedMessages: 0, recentTurns: 2 } }), { id: 'compact-1', kind: 'compaction', status: 'complete', compacted: false, compaction: { summary: '', compactedMessages: 0, recentTurns: 2 } })
})

test('marks a failed compaction without changing its identity', () => {
  assert.deepEqual(failCompactionNotice(createCompactionNotice('compact-2')), { id: 'compact-2', kind: 'compaction', status: 'error' })
})

test('restores the latest compaction summary for the transcript', () => {
  assert.deepEqual(restoreCompactionNotice('compact-history', { summary: 'Earlier facts', compactedMessages: 6, recentTurns: 3 }), { id: 'compact-history', kind: 'compaction', status: 'complete', compacted: true, compaction: { summary: 'Earlier facts', compactedMessages: 6, recentTurns: 3 } })
})
