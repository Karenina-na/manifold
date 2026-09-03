import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, fchmodSync, openSync } from 'node:fs'
import { chmod, mkdir, open, readFile, rm } from 'node:fs/promises'
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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'EPERM') return true
    if (error.code === 'ESRCH') return false
    throw error
  }
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

async function processMatchesSupervisor(pid, token) {
  if (process.platform !== 'linux') return true
  const commandLine = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return ''
    throw error
  })
  const argumentsList = commandLine.split('\0')
  return argumentsList.includes('supervise') && argumentsList.includes(token)
}

async function readLivePid(pidPath, root) {
  const raw = await readFile(pidPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  if (!raw) return null

  let record
  try {
    record = JSON.parse(raw)
  } catch {
    await rm(pidPath, { force: true })
    return null
  }
  const validRecord = Number.isInteger(record?.pid)
    && record.pid > 1
    && typeof record.token === 'string'
    && record.token.length > 0
    && record.root === root
  if (validRecord && processIsAlive(record.pid) && await processMatchesSupervisor(record.pid, record.token)) return record
  await rm(pidPath, { force: true })
  return null
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
    if (!processIsAlive(supervisor.pid)) throw new Error('supervisor exited during startup')
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
  const existing = await readLivePid(pidPath, root)
  if (existing) throw new Error(`Manifold is already running with PID ${existing.pid}`)
  for (const service of ['core', 'web', 'admin']) await assertPortAvailable(manifest[service].port)

  const logFd = openSync(join(logDirectory, 'supervisor.log'), 'a')
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
    if (processIsAlive(supervisor.pid)) signalProcessGroup(supervisor.pid, 'SIGTERM')
    throw error
  }
  console.log(`Manifold started\nWeb: ${manifest.web.url}\nAdmin: ${manifest.admin.url}\nCore: ${manifest.core.url}`)
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return !processIsAlive(pid)
}

async function stop(root, { quiet = false } = {}) {
  const pidPath = join(root, 'run', 'manifold.pid')
  const record = await readLivePid(pidPath, root)
  if (!record) {
    if (!quiet) console.log('Manifold is not running')
    return
  }
  signalProcessGroup(record.pid, 'SIGTERM')
  if (!(await waitForProcessExit(record.pid, 10_000))) {
    signalProcessGroup(record.pid, 'SIGKILL')
    await waitForProcessExit(record.pid, 2_000)
  }
  await removePidRecord(pidPath, record)
  if (!quiet) console.log('Manifold stopped')
}

async function status(root) {
  const record = await readLivePid(join(root, 'run', 'manifold.pid'), root)
  if (!record) throw new Error('Manifold is not running')
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

async function supervise(root) {
  process.umask(0o077)
  const { environment, manifest } = await loadRuntime(root)
  const runDirectory = join(root, 'run')
  const logDirectory = join(root, 'logs')
  await secureRuntimePaths(root)
  const pidPath = join(runDirectory, 'manifold.pid')
  const token = process.argv[3]
  if (!token) throw new Error('supervisor token is required')
  const pidFile = await open(pidPath, 'wx', 0o600)
  const record = { pid: process.pid, token, root }
  await pidFile.writeFile(`${JSON.stringify(record)}\n`)
  await pidFile.close()

  const children = []
  const baseEnvironment = serviceEnvironment(environment)
  let adminServer
  let shuttingDown = false
  let webRestartTimer
  let webRestartAttempt = 0
  const launch = (command, args, options, logName) => {
    const logFd = openSync(join(logDirectory, logName), 'a')
    fchmodSync(logFd, 0o600)
    const child = spawn(command, args, { ...options, stdio: ['ignore', logFd, logFd] })
    closeSync(logFd)
    children.push(child)
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
      const forgetWeb = () => {
        const index = children.indexOf(web)
        if (index >= 0) children.splice(index, 1)
      }
      web.once('error', (error) => {
        forgetWeb()
        console.error('service_spawn_error', { service: 'web', error })
        scheduleWebRestart()
      })
      web.once('exit', (code, signal) => {
        forgetWeb()
        if (shuttingDown) return
        const delay = Math.min(30_000, 250 * (2 ** webRestartAttempt))
        webRestartAttempt += 1
        console.error('service_exited', { service: 'web', pid: web.pid, code, signal, restartInMs: delay })
        scheduleWebRestart(delay)
      })
    }
    const scheduleWebRestart = (delay = Math.min(30_000, 250 * (2 ** webRestartAttempt))) => {
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
