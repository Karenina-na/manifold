import assert from 'node:assert/strict'
import test from 'node:test'
import { agentCommands, completeAgentCommands, parseAgentCommand } from './agent-commands.ts'

test('offers slash command completions by prefix', () => {
  assert.deepEqual(completeAgentCommands('/').map((command) => command.name), ['/compact', '/quit', '/clear'])
  assert.deepEqual(completeAgentCommands('/c').map((command) => command.name), ['/compact', '/clear'])
  assert.deepEqual(completeAgentCommands('/co').map((command) => command.name), ['/compact'])
})

test('does not complete commands after arguments or ordinary text', () => {
  assert.deepEqual(completeAgentCommands('hello'), [])
  assert.deepEqual(completeAgentCommands('/compact now'), [])
  assert.deepEqual(completeAgentCommands(' /compact'), [])
})

test('parses only exact supported commands', () => {
  assert.equal(parseAgentCommand('/compact'), 'compact')
  assert.equal(parseAgentCommand(' /CLEAR '), 'clear')
  assert.equal(parseAgentCommand('/quit'), 'quit')
  assert.equal(parseAgentCommand('/unknown'), undefined)
  assert.equal(parseAgentCommand('/compact now'), undefined)
  assert.equal(agentCommands.length, 3)
})
