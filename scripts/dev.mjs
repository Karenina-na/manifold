import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const modulePath = fileURLToPath(import.meta.url)
const root = resolve(dirname(modulePath), '..')
const services = [
  { name: 'web', packageName: '@manifold/web' },
  { name: 'admin', packageName: '@manifold/admin' },
]

export function restartDelay(attempt) {
  return Math.min(30_000, 250 * (2 ** Math.max(0, attempt)))
}

export const RESTART_LIMIT = 5
export const RESTART_RESET_AFTER_MS = 60_000

// Same shape as the release supervisor's Web policy (`scripts/release/runtime.mjs`
// `nextWebRestart`), kept separate on purpose: the release bundle only ships
// runtime.mjs/config.mjs/admin-server.mjs, so sharing six lines would add a
// packaging dependency between two independently run supervisors.
//
// The previous loop only ever grew its attempt counter, so a port conflict or a
// broken config meant a restart every 30 seconds forever, and a server that had
// run fine for an hour and then crashed once still paid the ceiling. A child
// that ran for `resetAfterMs` counts as recovered; `limit` consecutive failures
// stop the loop and say so.
export function nextRestart({ attempts, uptimeMs, limit = RESTART_LIMIT, resetAfterMs = RESTART_RESET_AFTER_MS }) {
  const effective = uptimeMs >= resetAfterMs ? 0 : attempts
  if (effective >= limit) return { action: 'give-up', attempts: effective }
  return { action: 'restart', attempts: effective + 1, delayMs: restartDelay(effective) }
}

export function shouldRestartService({ stopping, code, signal }) {
  if (stopping || signal === 'SIGINT') return false
  return code !== 0 || signal !== null
}

function stopProcessGroup(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

// Extracted so the wiring can be exercised without spawning anything: `main()`
// only runs when this module is the entry point, so a test that merely greps the
// source would pass even with the handler disabled.
export function installProcessHandlers({ stopAll }) {
  process.once('SIGINT', () => void stopAll(130))
  process.once('SIGTERM', () => void stopAll(143))
  process.once('uncaughtException', (error) => {
    console.error('[dev] supervisor error', error)
    void stopAll(1)
  })
  // Without this the process dies on an unhandled rejection with the services
  // still holding their ports and nothing said about why.
  process.on('unhandledRejection', (reason) => {
    console.error('[dev] supervisor unhandled rejection', reason)
    void stopAll(1)
  })
}

async function main() {
  const state = new Map(services.map((service) => [service.name, { ...service, child: null, timer: null, attempts: 0 }]))
  let stopping = false

  const scheduleRestart = (entry, code, signal, uptimeMs) => {
    if (!shouldRestartService({ stopping, code, signal }) || entry.timer) return
    const decision = nextRestart({ attempts: entry.attempts, uptimeMs })
    if (decision.action === 'give-up') {
      console.error(`[dev] ${entry.name} failed ${decision.attempts} times in a row; not restarting again. Fix the error above, then run pnpm dev.`)
      return
    }
    entry.attempts = decision.attempts
    console.error(`[dev] ${entry.name} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); restarting in ${decision.delayMs}ms`)
    entry.timer = setTimeout(() => {
      entry.timer = null
      startService(entry)
    }, decision.delayMs)
  }

  const startService = (entry) => {
    if (stopping) return
    const startedAt = Date.now()
    const child = spawn('pnpm', ['--filter', entry.packageName, 'dev'], {
      cwd: root,
      detached: true,
      env: process.env,
      stdio: 'inherit',
    })
    entry.child = child
    // A failed spawn emits `error` and, on some platforms, `exit` as well; the
    // flag keeps one failure from counting twice against the restart limit.
    let settled = false
    const handleGone = (code, signal) => {
      if (settled) return
      settled = true
      if (entry.child === child) entry.child = null
      scheduleRestart(entry, code, signal, Date.now() - startedAt)
    }
    child.once('error', (error) => {
      console.error(`[dev] ${entry.name} spawn failed`, error)
      handleGone(child.exitCode, child.signalCode)
    })
    child.once('exit', (code, signal) => handleGone(code, signal))
  }

  const stopAll = async (exitCode) => {
    if (stopping) return
    stopping = true
    for (const entry of state.values()) {
      if (entry.timer) clearTimeout(entry.timer)
      stopProcessGroup(entry.child, 'SIGTERM')
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
    for (const entry of state.values()) stopProcessGroup(entry.child, 'SIGKILL')
    process.exit(exitCode)
  }

  installProcessHandlers({ stopAll })
  for (const entry of state.values()) startService(entry)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  void main()
}
