import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, fchmodSync, openSync } from 'node:fs'
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAdminServer } from './admin-server.mjs'
import { loadReleaseConfig } from './config.mjs'

const modulePath = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(modulePath), '..')
const minimumNodeVersion = [20, 9, 0]

export function nodeVersionSupported(version = process.versions.node) {
  const parts = version.split('.').map(Number)
  for (let index = 0; index < minimumNodeVersion.length; index += 1) {
    if ((parts[index] ?? 0) > minimumNodeVersion[index]) return true
    if ((parts[index] ?? 0) < minimumNodeVersion[index]) return false
  }
  return true
}

function releaseRoot() {
  return resolve(process.env.MANIFOLD_RELEASE_ROOT || defaultRoot)
}

// Services inherit the supervisor's environment minus the prefixes that could
// silently override the packaged configuration. What this does *not* promise:
// only these three prefixes are stripped, so a host `NODE_ENV`/`PORT`/`HOSTNAME`
// still reaches the children (harmless — `supervise` sets all three explicitly
// per service, after this spread) and `MANIFOLD_*` deliberately passes through,
// because `MANIFOLD_RELEASE_ROOT` is a supervisor control variable and the
// release tests drive their fixtures with `MANIFOLD_FIXTURE_*`. Stripping
// `NEXT_PUBLIC_*`/`VITE_*` is defence in depth rather than the real protection:
// both are inlined at build time, so a runtime value cannot reach the bundle.
// The guarantee that matters is `CORE_*`: a host value must never override the
// `.env` shipped inside the archive.
function serviceEnvironment(environment) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !key.startsWith('CORE_') && !key.startsWith('NEXT_PUBLIC_') && !key.startsWith('VITE_')
  )))
  return { ...inherited, ...environment }
}

async function secureRuntimePaths(root) {
  const directories = [join(root, 'data'), join(root, 'logs'), join(root, 'run')]
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
  await Promise.all([
    ...directories.map((directory) => chmod(directory, 0o700)),
    chmod(join(root, '.env'), 0o600),
  ])
}

// A process that has exited but not been reaped stays in the process table as a
// zombie: it still owns its PID, so kill(pid, 0) succeeds, yet it runs no code
// and holds no ports. Counting a zombie as alive makes stop wait out its whole
// SIGTERM grace period on a process that is already gone, and makes start
// believe a dead supervisor still owns the deployment. The release target is a
// Linux host or container whose PID 1 may not reap, so liveness consults
// /proc; elsewhere init reaps zombies and kill(pid, 0) is all we have.
async function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === 'EPERM') return true
    if (error.code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  return !(await processIsZombie(pid))
}

async function processIsZombie(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  // "pid (comm) state ...", where comm may itself contain spaces and
  // parentheses, so the state field is located from the last ")".
  const end = stat.lastIndexOf(')')
  if (end < 0) return false
  const state = stat.slice(end + 2, end + 3)
  return state === 'Z' || state === 'X'
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
    try {
      process.kill(pid, signal)
    } catch (fallbackError) {
      if (fallbackError.code !== 'ESRCH') throw fallbackError
    }
  }
}

// Runs a command and captures stdout, resolving null when the command could not
// be run or exited non-zero. spawn() throws synchronously on some platform
// restrictions (macOS denies ps outright in hardened environments), so the call
// itself is guarded and never allowed to escape as an exception.
function captureCommand(command, args) {
  return new Promise((resolveCapture) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolveCapture(null)
      return
    }
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.once('error', () => resolveCapture(null))
    child.once('close', (code) => resolveCapture(code === 0 ? stdout : null))
  })
}

// Returns the process command line, or null when it cannot be determined. The
// distinction matters: "" means the process is gone, null means we simply do not
// know, and the two callers below resolve null in opposite — both safe —
// directions. Linux reads /proc; everything else goes through ps, which is why
// the previous Linux-only shortcut made stop/restart willing to signal an
// unrelated process group on a developer machine.
async function readProcessCommand(pid) {
  if (process.platform === 'linux') {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      if (error.code === 'EACCES') return null
      throw error
    })
    return raw === null ? null : raw.split('\0').join(' ')
  }
  // -ww defeats ps's default column truncation, which would otherwise cut the
  // token or the release root off the end of a long node command line.
  const stdout = await captureCommand('ps', ['-ww', '-o', 'command=', '-p', String(pid)])
  return stdout === null ? null : stdout.trim()
}

// Unknown resolves to true: an unverifiable record must never be mistaken for a
// dead supervisor, because that would make start/stop reap a running
// deployment's services.
async function processMatchesSupervisor(pid, token) {
  const command = await readProcessCommand(pid)
  return command === null || command.includes(token)
}

// Unknown resolves to false: without a confirmed command line naming this
// release root, the PID may have been recycled, and signalling it could kill an
// unrelated process.
async function processMatchesService(pid, root) {
  const command = await readProcessCommand(pid)
  return command !== null && command.includes(root)
}

// The record is written by the supervisor and read by start/stop/status, so a
// torn read is a real hazard: half a record parses as garbage, and a reader
// that reacts by deleting the file erases the only pointer to a running
// supervisor. Writes therefore go through a temporary file plus link/rename,
// which are atomic, and readers never delete what they cannot interpret as a
// *decision* — only as part of an explicit reclaim.
function pidRecordSource(record) {
  return `${JSON.stringify(record)}\n`
}

function temporaryPidPath(pidPath) {
  return `${pidPath}.${process.pid}.tmp`
}

// Exclusive claim: link() fails with EEXIST if the path already exists, and it
// publishes the fully written record in the same atomic step, so a concurrent
// start can never observe a half-written pid file.
async function claimPidRecord(pidPath, record) {
  const temporary = temporaryPidPath(pidPath)
  await writeFile(temporary, pidRecordSource(record), { mode: 0o600 })
  try {
    await link(temporary, pidPath)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function writePidRecord(pidPath, record) {
  const temporary = temporaryPidPath(pidPath)
  await writeFile(temporary, pidRecordSource(record), { mode: 0o600 })
  await rename(temporary, pidPath)
}

const PID_RECORD_ABSENT = 'absent'
const PID_RECORD_LIVE = 'live'
const PID_RECORD_STALE = 'stale'
const PID_RECORD_FOREIGN = 'foreign'

// Distinguishes "no supervisor" from "our supervisor died without cleaning up".
// The old readLivePid collapsed both into null and deleted the file on the way,
// which destroyed the child PIDs needed to reclaim the services.
async function classifyPidRecord(pidPath, root) {
  const raw = await readFile(pidPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  if (!raw) return { state: PID_RECORD_ABSENT, record: null }

  let record
  try {
    record = JSON.parse(raw)
  } catch {
    // Atomic writes mean this runtime cannot produce a torn record, so an
    // unparseable file is state left by an older layout or by hand.
    return { state: PID_RECORD_FOREIGN, record: null }
  }
  const ours = Number.isInteger(record?.pid)
    && record.pid > 1
    && typeof record.token === 'string'
    && record.token.length > 0
    && record.root === root
  if (!ours) return { state: PID_RECORD_FOREIGN, record: null }
  if (await processIsAlive(record.pid) && await processMatchesSupervisor(record.pid, record.token)) {
    return { state: PID_RECORD_LIVE, record }
  }
  return { state: PID_RECORD_STALE, record }
}

async function readLivePid(pidPath, root) {
  const { state, record } = await classifyPidRecord(pidPath, root)
  return state === PID_RECORD_LIVE ? record : null
}

// A supervisor killed with SIGKILL runs no cleanup, so its services keep the
// ports while the pid file points at a dead PID. The recorded child PIDs are
// the only way back to them, and each one is re-verified against the release
// root before it is signalled, so a recycled PID is never touched. Only the
// children are signalled — never the recorded supervisor PID, which may since
// have been reused by an unrelated process.
async function reapOrphanedChildren(record) {
  const signalled = []
  for (const pid of Array.isArray(record.children) ? record.children : []) {
    if (!Number.isInteger(pid) || pid <= 1 || !(await processIsAlive(pid))) continue
    if (!(await processMatchesService(pid, record.root))) continue
    try {
      process.kill(pid, 'SIGTERM')
      signalled.push(pid)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  for (const pid of signalled) {
    if (await waitForProcessExit(pid, 5_000)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    await waitForProcessExit(pid, 2_000)
  }
  return signalled
}

async function removePidRecord(pidPath, record) {
  const current = await readFile(pidPath, 'utf8').then(JSON.parse).catch(() => null)
  if (current?.pid === record.pid && current?.token === record.token) await rm(pidPath, { force: true })
}

async function loadRuntime(root) {
  const [{ environment }, manifestSource] = await Promise.all([
    loadReleaseConfig(join(root, '.env')),
    readFile(join(root, 'release.json'), 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  if (manifest.target !== 'linux-x64-glibc') throw new Error('release.json has an unsupported target')
  for (const service of ['core', 'web', 'admin']) {
    if (!Number.isInteger(manifest[service]?.port) || manifest[service].port < 1 || manifest[service].port > 65535) {
      throw new Error(`release.json has an invalid ${service} port`)
    }
  }
  return { environment, manifest }
}

function localUrls(manifest) {
  return {
    core: `http://127.0.0.1:${manifest.core.port}/healthz`,
    web: `http://127.0.0.1:${manifest.web.port}/health`,
    admin: `http://127.0.0.1:${manifest.admin.port}/`,
  }
}

async function urlIsHealthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

async function waitForHealthyServices(manifest, supervisor, pidPath, root, timeoutMs) {
  const urls = Object.values(localUrls(manifest))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await processIsAlive(supervisor.pid))) throw new Error('supervisor exited during startup')
    const record = await readLivePid(pidPath, root)
    if (record && record.pid !== supervisor.pid) throw new Error(`another supervisor started with PID ${record.pid}`)
    if (record && (await Promise.all(urls.map(urlIsHealthy))).every(Boolean)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`services did not become healthy within ${timeoutMs}ms`)
}

async function assertPortAvailable(port) {
  const server = createNetServer()
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(port, '0.0.0.0', resolveListen)
    })
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`port ${port} is already in use`)
    throw error
  } finally {
    if (server.listening) await new Promise((resolveClose) => server.close(resolveClose))
  }
}

async function start(root) {
  if (!nodeVersionSupported()) throw new Error(`Node.js >=${minimumNodeVersion.join('.')} is required`)
  const { manifest } = await loadRuntime(root)
  const runDirectory = join(root, 'run')
  const logDirectory = join(root, 'logs')
  const pidPath = join(runDirectory, 'manifold.pid')
  await secureRuntimePaths(root)
  const { state, record } = await classifyPidRecord(pidPath, root)
  if (state === PID_RECORD_LIVE) throw new Error(`Manifold is already running with PID ${record.pid}`)
  if (state === PID_RECORD_STALE) {
    // The previous supervisor died without running its shutdown path (SIGKILL,
    // power loss). Its services still hold the ports, so reclaim them before
    // the port check below — otherwise start fails with "port already in use"
    // and the operator has no way forward.
    const reaped = await reapOrphanedChildren(record)
    await rm(pidPath, { force: true })
    if (reaped.length > 0) console.log(`Reclaimed ${reaped.length} orphaned service process(es) left by supervisor PID ${record.pid}`)
  } else if (state === PID_RECORD_FOREIGN) {
    await rm(pidPath, { force: true })
  }
  for (const service of ['core', 'web', 'admin']) await assertPortAvailable(manifest[service].port)

  const logFd = openSync(join(logDirectory, 'supervisor.log'), 'a', 0o600)
  fchmodSync(logFd, 0o600)
  const token = randomUUID()
  const supervisor = spawn(process.execPath, [modulePath, 'supervise', token], {
    detached: true,
    env: { ...process.env, MANIFOLD_RELEASE_ROOT: root },
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)
  supervisor.unref()

  try {
    const timeout = Number(process.env.MANIFOLD_START_TIMEOUT_MS || 60_000)
    await waitForHealthyServices(manifest, supervisor, pidPath, root, timeout)
  } catch (error) {
    if (await processIsAlive(supervisor.pid)) signalProcessGroup(supervisor.pid, 'SIGTERM')
    throw error
  }
  console.log(`Manifold started\nWeb: ${manifest.web.url}\nAdmin: ${manifest.admin.url}\nCore: ${manifest.core.url}`)
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await processIsAlive(pid))) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return !(await processIsAlive(pid))
}

async function stop(root, { quiet = false } = {}) {
  const pidPath = join(root, 'run', 'manifold.pid')
  const { state, record } = await classifyPidRecord(pidPath, root)
  if (state === PID_RECORD_FOREIGN) await rm(pidPath, { force: true })
  if (state === PID_RECORD_ABSENT || state === PID_RECORD_FOREIGN) {
    if (!quiet) console.log('Manifold is not running')
    return
  }
  if (state === PID_RECORD_STALE) {
    // The supervisor is gone but its services may not be. Reclaim them before
    // reporting "not running", so stop never leaves orphans holding the ports.
    const reaped = await reapOrphanedChildren(record)
    await rm(pidPath, { force: true })
    if (!quiet) console.log(reaped.length > 0 ? `Manifold was not running; reclaimed ${reaped.length} orphaned service process(es)` : 'Manifold is not running')
    return
  }
  try {
    signalProcessGroup(record.pid, 'SIGTERM')
    if (!(await waitForProcessExit(record.pid, 10_000))) {
      signalProcessGroup(record.pid, 'SIGKILL')
      await waitForProcessExit(record.pid, 2_000)
    }
  } finally {
    // The record must go even when signalling failed: leaving it behind makes
    // every later start fail the port check with no way to clear it.
    await removePidRecord(pidPath, record)
  }
  if (!quiet) console.log('Manifold stopped')
}

async function status(root) {
  const pidPath = join(root, 'run', 'manifold.pid')
  const { state, record } = await classifyPidRecord(pidPath, root)
  if (state === PID_RECORD_FOREIGN) {
    await rm(pidPath, { force: true })
    throw new Error('Manifold is not running')
  }
  if (state !== PID_RECORD_LIVE) {
    throw new Error(state === PID_RECORD_STALE
      ? `Manifold is not running (supervisor PID ${record.pid} exited; run stop to reclaim its services)`
      : 'Manifold is not running')
  }
  const { manifest } = await loadRuntime(root)
  const urls = localUrls(manifest)
  const states = await Promise.all(Object.entries(urls).map(async ([name, url]) => [name, await urlIsHealthy(url)]))
  for (const [name, healthy] of states) console.log(`${name[0].toUpperCase()}${name.slice(1)}: ${healthy ? 'healthy' : 'unhealthy'}`)
  if (states.some(([, healthy]) => !healthy)) throw new Error(`Manifold supervisor PID ${record.pid} has unhealthy services`)
}

function waitForChild(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveWait(true)
    })
  })
}

export const WEB_RESTART_BASE_DELAY_MS = 250
export const WEB_RESTART_MAX_DELAY_MS = 30_000
export const WEB_RESTART_LIMIT = 5
export const WEB_RESTART_RESET_AFTER_MS = 60_000

// Backoff policy for a Web child that keeps exiting. Two defects lived here: the
// attempt counter only ever grew, so a Web that had served for hours and then
// crashed once still restarted at the 30s ceiling; and nothing bounded the
// count, so a Web that can never start (missing `server.js`, a port conflict)
// restarted forever while the deployment stayed broken — and the supervisor
// never settled, so nothing reported the failure. A child that ran for
// `resetAfterMs` counts as recovered and starts the count over, and `limit`
// consecutive failures stop the loop instead of hiding the breakage.
//
// Pure so the policy is testable without spawning anything, and deliberately
// not env-configurable: a hard bound is easier to reason about than a knob.
export function nextWebRestart({
  attempt,
  uptimeMs,
  limit = WEB_RESTART_LIMIT,
  resetAfterMs = WEB_RESTART_RESET_AFTER_MS,
  baseDelayMs = WEB_RESTART_BASE_DELAY_MS,
  maxDelayMs = WEB_RESTART_MAX_DELAY_MS,
}) {
  const effective = uptimeMs >= resetAfterMs ? 0 : attempt
  if (effective >= limit) return { action: 'give-up', attempt: effective }
  return {
    action: 'restart',
    attempt: effective + 1,
    delayMs: Math.min(maxDelayMs, baseDelayMs * (2 ** effective)),
  }
}

async function supervise(root) {
  process.umask(0o077)
  const { environment, manifest } = await loadRuntime(root)
  const runDirectory = join(root, 'run')
  const logDirectory = join(root, 'logs')
  await secureRuntimePaths(root)
  const pidPath = join(runDirectory, 'manifold.pid')
  const token = process.argv[3]
  if (!token) throw new Error('supervisor token is required')
  const record = { pid: process.pid, token, root, children: [] }
  try {
    await claimPidRecord(pidPath, record)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('another supervisor already claimed the pid file')
    throw error
  }

  // The record is rewritten whenever the child set changes, so a supervisor
  // killed with SIGKILL still leaves start/stop the PIDs needed to reclaim the
  // services. Writes are queued: rename is atomic, but two overlapping writers
  // could still publish the older record last.
  let persistQueue = Promise.resolve()
  const persistRecord = () => {
    persistQueue = persistQueue
      .then(() => writePidRecord(pidPath, record))
      .catch((error) => console.error('pidfile_write_failed', error))
    return persistQueue
  }

  const children = []
  const baseEnvironment = serviceEnvironment(environment)
  let adminServer
  let shuttingDown = false
  let webRestartTimer
  let webRestartAttempt = 0
  const launch = (command, args, options, logName) => {
    // The mode argument only applies when the file is created, which is exactly
    // the window that matters: without it the log exists as 0644 until the
    // fchmod below lands. The fchmod stays as the backstop for a file left by
    // an older release.
    const logFd = openSync(join(logDirectory, logName), 'a', 0o600)
    fchmodSync(logFd, 0o600)
    const child = spawn(command, args, { ...options, stdio: ['ignore', logFd, logFd] })
    closeSync(logFd)
    children.push(child)
    if (Number.isInteger(child.pid)) {
      record.children.push(child.pid)
      void persistRecord()
      child.once('exit', () => {
        const index = record.children.indexOf(child.pid)
        if (index >= 0) {
          record.children.splice(index, 1)
          void persistRecord()
        }
      })
    }
    return child
  }
  const shutdown = async (exitCode) => {
    if (shuttingDown) return
    shuttingDown = true
    if (webRestartTimer) clearTimeout(webRestartTimer)
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await Promise.all(children.map(async (child) => {
      if (!(await waitForChild(child, 8_000)) && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }))
    if (adminServer?.listening) await new Promise((resolveClose) => adminServer.close(resolveClose))
    await removePidRecord(pidPath, record)
    process.exit(exitCode)
  }

  process.once('SIGINT', () => void shutdown(0))
  process.once('SIGTERM', () => void shutdown(0))
  try {
    const core = launch(join(root, 'bin', 'manifold-core'), [], {
      cwd: root,
      env: { ...baseEnvironment, CORE_ADDR: `:${manifest.core.port}` },
    }, 'core.log')
    const webDirectory = join(root, 'web', 'app', 'web')
    const launchWeb = () => {
      const web = launch(process.execPath, [join(webDirectory, 'server.js')], {
        cwd: webDirectory,
        env: { ...baseEnvironment, NODE_ENV: 'production', HOSTNAME: manifest.web.host, PORT: String(manifest.web.port) },
      }, 'web.log')
      const startedAt = Date.now()
      const forgetWeb = () => {
        const index = children.indexOf(web)
        if (index >= 0) children.splice(index, 1)
      }
      // A failed spawn emits both `error` and, on some platforms, `exit`; the
      // flag keeps one failure from counting twice against the restart limit.
      let settled = false
      const handleWebGone = (details) => {
        if (settled) return
        settled = true
        forgetWeb()
        if (shuttingDown) return
        const decision = nextWebRestart({ attempt: webRestartAttempt, uptimeMs: Date.now() - startedAt })
        if (decision.action === 'give-up') {
          // Web is not coming back on its own. Core and Admin keep running so
          // the deployment stays inspectable and `status` reports Web as
          // unhealthy; the operator clears it with a restart.
          console.error('service_restart_limit_reached', { service: 'web', attempts: decision.attempt, limit: WEB_RESTART_LIMIT })
          return
        }
        webRestartAttempt = decision.attempt
        console.error('service_exited', { service: 'web', pid: web.pid, ...details, restartInMs: decision.delayMs })
        scheduleWebRestart(decision.delayMs)
      }
      web.once('error', (error) => {
        console.error('service_spawn_error', { service: 'web', error })
        handleWebGone({})
      })
      web.once('exit', (code, signal) => handleWebGone({ code, signal }))
    }
    const scheduleWebRestart = (delay) => {
      if (shuttingDown || webRestartTimer) return
      webRestartTimer = setTimeout(() => {
        webRestartTimer = undefined
        launchWeb()
      }, delay)
    }
    core.once('error', (error) => {
      console.error('service_spawn_error', { service: 'core', error })
      void shutdown(1)
    })
    core.once('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error('service_exited', { service: 'core', pid: core.pid, code, signal })
        void shutdown(code || 1)
      }
    })
    launchWeb()
    adminServer = createAdminServer({ root: join(root, 'admin') })
    adminServer.once('error', (error) => {
      console.error('admin_server_error', error)
      void shutdown(1)
    })
    await new Promise((resolveListen, reject) => {
      adminServer.once('error', reject)
      adminServer.listen(manifest.admin.port, manifest.admin.host, resolveListen)
    })
    console.log(`supervisor_ready pid=${process.pid}`)
  } catch (error) {
    console.error('supervisor_start_error', error)
    await shutdown(1)
  }
}

async function main() {
  const root = releaseRoot()
  const command = process.argv[2]
  if (command === 'start') await start(root)
  else if (command === 'stop') await stop(root)
  else if (command === 'restart') {
    await stop(root, { quiet: true })
    await start(root)
  } else if (command === 'status') await status(root)
  else if (command === 'supervise') await supervise(root)
  else throw new Error('Usage: ./manifold start|stop|restart|status')
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
