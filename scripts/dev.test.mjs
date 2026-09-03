import assert from 'node:assert/strict'
import test from 'node:test'

import { restartDelay, shouldRestartService } from './dev.mjs'

test('restarts a development service after an unexpected exit, including SIGTERM exit 143', () => {
  assert.equal(shouldRestartService({ stopping: false, code: 143, signal: null }), true)
  assert.equal(shouldRestartService({ stopping: false, code: 1, signal: null }), true)
  assert.equal(shouldRestartService({ stopping: false, code: -2, signal: null }), true)
  assert.equal(shouldRestartService({ stopping: true, code: 143, signal: null }), false)
})

test('uses bounded exponential backoff for repeated development crashes', () => {
  assert.equal(restartDelay(0), 250)
  assert.equal(restartDelay(1), 500)
  assert.equal(restartDelay(5), 8_000)
  assert.equal(restartDelay(20), 30_000)
})
