import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAgentEvent, formatAgentPayload, groupAgentMessages } from './agent-transcript.ts'

test('groups persisted user and assistant messages into conversation turns', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'First', createdAt: '2026-09-17T00:00:00Z' },
    { id: 'a1', role: 'assistant', content: 'Answer', createdAt: '2026-09-17T00:00:01Z', trace: { steps: [{ id: 'reasoning-1', kind: 'reasoning', status: 'complete', message: 'I checked the available evidence.' }, { id: 'call-1', kind: 'tool', name: 'calculator', input: { expression: '2+2' }, output: { result: 4 }, status: 'complete' }], finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } },
    { id: 'u2', role: 'user', content: 'Second', createdAt: '2026-09-17T00:00:02Z' },
    { id: 'a2', role: 'assistant', content: 'Another answer', createdAt: '2026-09-17T00:00:03Z' },
  ]
  const turns = groupAgentMessages(messages)
  assert.equal(turns.length, 2)
  assert.equal(turns[0]?.user?.content, 'First')
  assert.equal(turns[0]?.assistant?.content, 'Answer')
  assert.equal(turns[1]?.user?.content, 'Second')
  assert.equal(turns[1]?.assistant?.content, 'Another answer')
  assert.equal(turns[0]?.process.length, 2)
  assert.equal(turns[0]?.process[1]?.kind, 'tool')
  assert.equal(turns[0]?.process[1]?.status, 'complete')
  assert.equal(turns[0]?.process[0]?.message, 'I checked the available evidence.')
  assert.equal(turns[0]?.finishReason, 'stop')
  assert.equal(turns[0]?.usage?.totalTokens, 6)
})

test('keeps an orphan assistant message visible without moving later turns', () => {
  const turns = groupAgentMessages([
    { id: 'a0', role: 'assistant', content: 'Existing answer', createdAt: '2026-09-17T00:00:00Z' },
    { id: 'u1', role: 'user', content: 'Question', createdAt: '2026-09-17T00:00:01Z' },
  ])
  assert.equal(turns.length, 2)
  assert.equal(turns[0]?.assistant?.content, 'Existing answer')
  assert.equal(turns[1]?.user?.content, 'Question')
  assert.equal(turns[1]?.status, 'error')
})

test('reduces reasoning, tool, content, and finish events into one turn', () => {
  let turn = { id: 'turn', user: { id: 'u1', role: 'user', content: 'Question', createdAt: '2026-09-17T00:00:00Z' }, assistant: { id: 'a1', role: 'assistant', content: '', createdAt: '2026-09-17T00:00:00Z' }, process: [], status: 'idle' }
  turn = applyAgentEvent(turn, { type: 'run.started', runId: 'run_1', messageId: 'persisted-user-1' })
  turn = applyAgentEvent(turn, { type: 'reasoning.started', runId: 'run_1' })
  turn = applyAgentEvent(turn, { type: 'tool.started', callId: 'call_1', name: 'calculator', input: { expression: '2+2' } })
  turn = applyAgentEvent(turn, { type: 'tool.completed', callId: 'call_1', name: 'calculator', output: { result: 4 }, isError: false })
  turn = applyAgentEvent(turn, { type: 'reasoning.completed', runId: 'run_1', message: 'I checked the available evidence.' })
  turn = applyAgentEvent(turn, { type: 'content.delta', delta: '4' })
  turn = applyAgentEvent(turn, { type: 'run.completed', runId: 'run_1', finishReason: 'max_tokens', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } })
  assert.equal(turn.status, 'complete')
  assert.equal(turn.user.id, 'persisted-user-1')
  assert.equal(turn.finishReason, 'max_tokens')
  assert.equal(turn.assistant.content, '4')
  assert.equal(turn.process[0].status, 'complete')
  assert.equal(turn.process[0].message, 'I checked the available evidence.')
  assert.equal(turn.process[1].status, 'complete')
  assert.deepEqual(turn.process[1].output, { result: 4 })
  assert.equal(turn.usage.totalTokens, 4)
})

test('formats tool payloads predictably for compact details', () => {
  assert.equal(formatAgentPayload(undefined), '—')
  assert.equal(formatAgentPayload('value'), 'value')
  assert.equal(formatAgentPayload({ value: 1 }), '{\n  "value": 1\n}')
  assert.equal(formatAgentPayload('x'.repeat(12001)).length, 12002)
})
