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

async function main() {
  const state = new Map(services.map((service) => [service.name, { ...service, child: null, timer: null, attempts: 0 }]))
  let stopping = false

  const scheduleRestart = (entry, code, signal) => {
    if (!shouldRestartService({ stopping, code, signal }) || entry.timer) return
    const delay = restartDelay(entry.attempts)
    entry.attempts += 1
    console.error(`[dev] ${entry.name} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); restarting in ${delay}ms`)
    entry.timer = setTimeout(() => {
      entry.timer = null
      startService(entry)
    }, delay)
  }

  const startService = (entry) => {
    if (stopping) return
    const child = spawn('pnpm', ['--filter', entry.packageName, 'dev'], {
      cwd: root,
      detached: true,
      env: process.env,
      stdio: 'inherit',
    })
    entry.child = child
    child.once('error', (error) => {
      console.error(`[dev] ${entry.name} spawn failed`, error)
      if (entry.child === child) entry.child = null
      scheduleRestart(entry, child.exitCode, child.signalCode)
    })
    child.once('exit', (code, signal) => {
      if (entry.child === child) entry.child = null
      scheduleRestart(entry, code, signal)
    })
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

  process.once('SIGINT', () => void stopAll(130))
  process.once('SIGTERM', () => void stopAll(143))
  process.once('uncaughtException', (error) => {
    console.error('[dev] supervisor error', error)
    void stopAll(1)
  })
  for (const entry of state.values()) startService(entry)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  void main()
}
