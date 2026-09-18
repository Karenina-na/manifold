import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompactionNotice, failCompactionNotice, finishCompactionNotice } from './agent-notice.ts'

test('tracks compaction progress from running to completed', () => {
  const running = createCompactionNotice('compact-1')
  assert.deepEqual(running, { id: 'compact-1', kind: 'compaction', status: 'running' })
  assert.deepEqual(finishCompactionNotice(running, true), { id: 'compact-1', kind: 'compaction', status: 'complete', compacted: true })
  assert.deepEqual(finishCompactionNotice(running, false), { id: 'compact-1', kind: 'compaction', status: 'complete', compacted: false })
})

test('marks a failed compaction without changing its identity', () => {
  assert.deepEqual(failCompactionNotice(createCompactionNotice('compact-2')), { id: 'compact-2', kind: 'compaction', status: 'error' })
})
