import assert from 'node:assert/strict'
import test from 'node:test'

import { installProcessHandlers, nextRestart, restartDelay, RESTART_LIMIT, shouldRestartService } from './dev.mjs'

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

test('nextRestart stops restarting a service that fails immediately every time', () => {
  // A port conflict or a broken config used to restart every 30 seconds
  // forever; the loop now ends and says so.
  const delays = []
  let attempts = 0
  for (let round = 0; round < RESTART_LIMIT; round += 1) {
    const decision = nextRestart({ attempts, uptimeMs: 0 })
    assert.equal(decision.action, 'restart')
    assert.equal(decision.attempts, round + 1)
    delays.push(decision.delayMs)
    attempts = decision.attempts
  }
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000])
  assert.deepEqual(nextRestart({ attempts, uptimeMs: 0 }), { action: 'give-up', attempts: RESTART_LIMIT })
})

test('nextRestart resets the backoff once a service has run long enough to count as healthy', () => {
  assert.deepEqual(nextRestart({ attempts: RESTART_LIMIT, uptimeMs: 60_000 }), { action: 'restart', attempts: 1, delayMs: 250 })
  assert.deepEqual(nextRestart({ attempts: RESTART_LIMIT, uptimeMs: 59_999 }), { action: 'give-up', attempts: RESTART_LIMIT })
})

test('the dev supervisor reaps its services when a rejection escapes', () => {
  // Grepping the source for `unhandledRejection` would pass even with the
  // handler disabled, so the wiring is exercised instead: the registration is
  // captured, then the captured listener is called and has to tear down.
  const registered = new Map()
  const originalOn = process.on
  const originalOnce = process.once
  const originalError = console.error
  process.on = (event, listener) => { registered.set(event, listener); return process }
  process.once = (event, listener) => { registered.set(event, listener); return process }
  console.error = () => {}
  try {
    const exits = []
    installProcessHandlers({ stopAll: (code) => { exits.push(code) } })
    assert.equal(typeof registered.get('unhandledRejection'), 'function', 'an unhandled rejection must not kill the supervisor silently')
    registered.get('unhandledRejection')(new Error('boom'))
    assert.deepEqual(exits, [1])
    assert.equal(typeof registered.get('SIGTERM'), 'function')
  } finally {
    process.on = originalOn
    process.once = originalOnce
    console.error = originalError
  }
})
