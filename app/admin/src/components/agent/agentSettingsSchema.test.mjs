import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentSettingsSchema } from '../../features/settings/agentSettingsSchema.ts'

const schema = createAgentSettingsSchema((key) => key)
const valid = {
  provider: 'openai',
  model: 'gpt-5-mini',
  maxToolRounds: 6,
  historyLimit: 40,
  compactionRecentTurns: 8,
  compactionMaxOutputTokens: 1024,
  maxOutputTokens: 2048,
  openAIBaseURL: 'https://api.openai.com/v1',
  apiKey: '',
  clearAPIKey: false,
}

test('accepts adjustable compaction settings', () => {
  const result = schema.safeParse(valid)
  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data.compactionRecentTurns, 8)
    assert.equal(result.data.compactionMaxOutputTokens, 1024)
  }
})

test('rejects compaction settings that cannot release a complete turn', () => {
  const result = schema.safeParse({ ...valid, historyLimit: 12, compactionRecentTurns: 6 })
  assert.equal(result.success, false)
})

test('bounds compaction summary output tokens', () => {
  assert.equal(schema.safeParse({ ...valid, compactionMaxOutputTokens: 127 }).success, false)
  assert.equal(schema.safeParse({ ...valid, compactionMaxOutputTokens: 8193 }).success, false)
})

test('keeps legacy low history thresholds configurable with one recent turn', () => {
  assert.equal(schema.safeParse({ ...valid, historyLimit: 1, compactionRecentTurns: 1 }).success, true)
  assert.equal(schema.safeParse({ ...valid, historyLimit: 3, compactionRecentTurns: 2 }).success, false)
})
