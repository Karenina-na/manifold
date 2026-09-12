import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import { nextWebRestart, nodeVersionSupported, WEB_RESTART_LIMIT } from './runtime.mjs'

const execute = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const runtimePath = resolve(here, 'runtime.mjs')

// Reclaiming an orphaned service means reading that process's command line to
// prove the PID is still ours. Linux does that through /proc; everywhere else
// goes through ps, which hardened environments can deny outright — so the
// orphan tests skip rather than fail for an unrelated reason.
const processIdentityAvailable = process.platform === 'linux' || (await (async () => {
  try {
    const { stdout } = await execute('ps', ['-ww', '-o', 'command=', '-p', String(process.pid)])
    return stdout.trim().length > 0
  } catch {
    return false
  }
})())

function isAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
  return !isZombie(pid)
}

// A SIGKILLed supervisor whose parent never reaped it stays in the process table
// as a zombie, where kill(pid, 0) still succeeds. The Linux container this suite
// runs in on CI has a non-reaping PID 1, so liveness must consult /proc there.
function isZombie(pid) {
  if (process.platform !== 'linux') return false
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const end = stat.lastIndexOf(')')
    const state = stat.slice(end + 2, end + 3)
    return state === 'Z' || state === 'X'
  } catch {
    return false
  }
}

async function readPidRecord(root) {
  const source = await readFile(join(root, 'run', 'manifold.pid'), 'utf8').catch(() => '')
  return source ? JSON.parse(source) : null
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return false
}

// Leaves the fixture in the state a SIGKILLed supervisor produces: the recorded
// supervisor PID is dead while its services still hold the ports.
async function killSupervisorOnly(root) {
  assert.equal(await waitFor(async () => ((await readPidRecord(root))?.children?.length ?? 0) >= 2, 5_000), true)
  const supervisor = await readPidRecord(root)
  process.kill(supervisor.pid, 'SIGKILL')
  assert.equal(await waitFor(async () => !isAlive(supervisor.pid), 5_000), true)
  for (const pid of supervisor.children) assert.equal(isAlive(pid), true)
  return supervisor
}

async function stopFixture(root, environment) {
  await execute(process.execPath, [runtimePath, 'stop'], { env: environment }).catch(() => null)
  const source = await readFile(join(root, 'run', 'manifold.pid'), 'utf8').catch(() => '')
  if (!source) return
  const pid = JSON.parse(source).pid
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const { port } = server.address()
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'manifold-runtime-'))
  const [corePort, webPort, adminPort] = await Promise.all([freePort(), freePort(), freePort()])
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(root, 'web', 'app', 'web'), { recursive: true })
  await mkdir(join(root, 'admin'), { recursive: true })
  await writeFile(join(root, 'admin', 'index.html'), '<title>Fixture Admin</title>')
  await writeFile(join(root, '.env'), `
CORE_ENV=production
CORE_ADDR=:8080
CORE_DATABASE_PATH=./data/manifold.db
CORE_ALLOWED_ORIGINS=http://203.0.113.10:3000,http://203.0.113.10:5173
CORE_JWT_SECRET=replace-with-a-long-random-secret
CORE_ADMIN_PASSWORD_HASH=$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X
CORE_PUBLIC_URL=http://203.0.113.10:8080
NEXT_PUBLIC_CORE_URL=http://203.0.113.10:8080
NEXT_PUBLIC_SITE_URL=http://203.0.113.10:3000
VITE_CORE_URL=http://203.0.113.10:8080
VITE_WEB_URL=http://203.0.113.10:3000
`)
  await writeFile(join(root, 'release.json'), JSON.stringify({
    target: 'linux-x64-glibc',
    core: { host: '0.0.0.0', port: corePort, url: `http://127.0.0.1:${corePort}` },
    web: { host: '0.0.0.0', port: webPort, url: `http://127.0.0.1:${webPort}` },
    admin: { host: '0.0.0.0', port: adminPort, url: `http://127.0.0.1:${adminPort}` },
  }))
const serviceSource = `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
if (!process.env.PORT && process.env.CORE_SEED_FILE) process.exit(23)
const port = Number(process.env.PORT || process.env.CORE_ADDR.split(':').at(-1))
const health = process.env.PORT ? (process.env.MANIFOLD_FIXTURE_WEB_HEALTH || '/health') : '/healthz'
const server = http.createServer((request, response) => {
  response.writeHead(request.url === health ? 200 : 404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ status: 'ok' }))
}).listen(port, '0.0.0.0')
if (!process.env.PORT && process.env.MANIFOLD_FIXTURE_CORE_EXIT_MS) {
  setTimeout(() => server.close(() => process.exit(42)), Number(process.env.MANIFOLD_FIXTURE_CORE_EXIT_MS))
}
if (process.env.PORT && process.env.MANIFOLD_FIXTURE_WEB_EXIT_MS && (!process.env.MANIFOLD_FIXTURE_WEB_EXIT_ONCE || !fs.existsSync(process.env.MANIFOLD_FIXTURE_WEB_EXIT_ONCE))) {
  if (process.env.MANIFOLD_FIXTURE_WEB_EXIT_ONCE) fs.writeFileSync(process.env.MANIFOLD_FIXTURE_WEB_EXIT_ONCE, '1')
  setTimeout(() => server.close(() => process.exit(43)), Number(process.env.MANIFOLD_FIXTURE_WEB_EXIT_MS))
}
`
  await writeFile(join(root, 'bin', 'manifold-core'), serviceSource)
  await chmod(join(root, 'bin', 'manifold-core'), 0o755)
  await writeFile(join(root, 'web', 'app', 'web', 'server.js'), serviceSource)
  return { root, ports: [corePort, webPort, adminPort] }
}

test('nodeVersionSupported enforces the Next.js runtime floor', () => {
  assert.equal(nodeVersionSupported('20.9.0'), true)
  assert.equal(nodeVersionSupported('20.8.9'), false)
  assert.equal(nodeVersionSupported('18.20.0'), false)
  assert.equal(nodeVersionSupported('22.0.0'), true)
})

test('nextWebRestart backs off, then gives up instead of restarting forever', () => {
  // A Web that dies immediately walks the doubling ladder and stops at the
  // limit. Before the bound existed this returned a restart for every attempt.
  const delays = []
  let attempt = 0
  for (let round = 0; round < WEB_RESTART_LIMIT; round += 1) {
    const decision = nextWebRestart({ attempt, uptimeMs: 0 })
    assert.equal(decision.action, 'restart')
    assert.equal(decision.attempt, round + 1)
    delays.push(decision.delayMs)
    attempt = decision.attempt
  }
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000])
  assert.deepEqual(nextWebRestart({ attempt, uptimeMs: 0 }), { action: 'give-up', attempt: WEB_RESTART_LIMIT })
})

test('nextWebRestart resets the backoff after a run long enough to count as healthy', () => {
  // The old counter only ever grew: a Web that served for an hour and then
  // crashed once still restarted at the ceiling.
  assert.deepEqual(nextWebRestart({ attempt: WEB_RESTART_LIMIT - 1, uptimeMs: 60_000 }), {
    action: 'restart',
    attempt: 1,
    delayMs: 250,
  })
  // A child that dies just short of the threshold still counts toward the limit:
  // at the limit the next failure gives up rather than resetting.
  assert.deepEqual(nextWebRestart({ attempt: WEB_RESTART_LIMIT, uptimeMs: 59_999 }), {
    action: 'give-up',
    attempt: WEB_RESTART_LIMIT,
  })
  // The ceiling holds even at a high attempt count.
  assert.equal(nextWebRestart({ attempt: 20, uptimeMs: 0, limit: 30 }).delayMs, 30_000)
})

test('runtime manages the service group and cleans up its pid', { timeout: 20_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    CORE_SEED_FILE: '/tmp/host-must-not-leak.json',
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '5000',
  }
  try {
    const started = await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    assert.match(started.stdout, /Manifold started/)
    for (const directory of ['data', 'logs', 'run']) {
      assert.equal((await stat(join(fixture.root, directory))).mode & 0o777, 0o700)
    }
    for (const file of ['core.log', 'supervisor.log', 'web.log']) {
      assert.equal((await stat(join(fixture.root, 'logs', file))).mode & 0o777, 0o600)
    }
    assert.equal((await stat(join(fixture.root, 'run', 'manifold.pid'))).mode & 0o777, 0o600)

    const duplicate = await execute(process.execPath, [runtimePath, 'start'], { env: environment }).catch((error) => error)
    assert.notEqual(duplicate.code, 0)
    assert.match(duplicate.stderr, /already running/)

    const status = await execute(process.execPath, [runtimePath, 'status'], { env: environment })
    assert.match(status.stdout, /Core: healthy/)
    assert.match(status.stdout, /Web: healthy/)
    assert.match(status.stdout, /Admin: healthy/)

    await writeFile(join(fixture.root, 'data', 'persist.txt'), 'keep')
    const restarted = await execute(process.execPath, [runtimePath, 'restart'], { env: environment })
    assert.match(restarted.stdout, /Manifold started/)
    assert.equal(await readFile(join(fixture.root, 'data', 'persist.txt'), 'utf8'), 'keep')

    const stopped = await execute(process.execPath, [runtimePath, 'stop'], { env: environment })
    assert.match(stopped.stdout, /Manifold stopped/)
    await assert.rejects(readFile(join(fixture.root, 'run', 'manifold.pid')), /ENOENT/)
    for (const port of fixture.ports) await assert.rejects(fetch(`http://127.0.0.1:${port}`))
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('start rejects a service whose health endpoint returns 404', { timeout: 10_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    MANIFOLD_FIXTURE_WEB_HEALTH: '/missing-health',
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '800',
  }
  try {
    const started = await execute(process.execPath, [runtimePath, 'start'], { env: environment }).catch((error) => error)
    assert.notEqual(started.code, 0)
    assert.match(started.stderr, /services did not become healthy/)
    for (const port of fixture.ports) await assert.rejects(fetch(`http://127.0.0.1:${port}`))
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('status ignores a legacy numeric pid file instead of trusting an unrelated process', async () => {
  const fixture = await createFixture()
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const environment = { ...process.env, MANIFOLD_RELEASE_ROOT: fixture.root }
  try {
    await mkdir(join(fixture.root, 'run'), { recursive: true })
    await writeFile(join(fixture.root, 'run', 'manifold.pid'), `${unrelated.pid}\n`)

    const status = await execute(process.execPath, [runtimePath, 'status'], { env: environment }).catch((error) => error)
    assert.notEqual(status.code, 0)
    assert.match(status.stderr, /Manifold is not running/)
    await assert.rejects(readFile(join(fixture.root, 'run', 'manifold.pid')), /ENOENT/)
  } finally {
    if (unrelated.exitCode === null) unrelated.kill('SIGKILL')
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('supervisor stops the service group when Core exits unexpectedly', { timeout: 10_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    MANIFOLD_FIXTURE_CORE_EXIT_MS: '1200',
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '5000',
  }
  try {
    await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const pid = await readFile(join(fixture.root, 'run', 'manifold.pid'), 'utf8').catch(() => '')
      if (!pid) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    await assert.rejects(readFile(join(fixture.root, 'run', 'manifold.pid')), /ENOENT/)
    for (const port of fixture.ports) await assert.rejects(fetch(`http://127.0.0.1:${port}`))
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('supervisor restarts Web without stopping healthy Core and Admin', { timeout: 10_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    MANIFOLD_FIXTURE_WEB_EXIT_MS: '1200',
    MANIFOLD_FIXTURE_WEB_EXIT_ONCE: join(fixture.root, 'web-exit-once'),
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '5000',
  }
  try {
    await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000))
    await assert.doesNotReject(fetch(`http://127.0.0.1:${fixture.ports[0]}/healthz`))
    await assert.doesNotReject(fetch(`http://127.0.0.1:${fixture.ports[1]}/health`))
    await assert.doesNotReject(fetch(`http://127.0.0.1:${fixture.ports[2]}/`))
    assert.match(await readFile(join(fixture.root, 'run', 'manifold.pid'), 'utf8'), /"pid"/)
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('supervisor gives up on a Web that can never start, and says so', { timeout: 40_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    // Web exits on its own every time, so it never becomes healthy.
    MANIFOLD_FIXTURE_WEB_EXIT_MS: '50',
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '60000',
  }
  // `start` never returns here — Web cannot become healthy — so it runs in the
  // background and the test watches the supervisor log instead of waiting out
  // the start timeout.
  const starter = spawn(process.execPath, [runtimePath, 'start'], { env: environment, stdio: 'ignore' })
  const logPath = join(fixture.root, 'logs', 'supervisor.log')
  try {
    const reached = await waitFor(async () => (await readFile(logPath, 'utf8').catch(() => '')).includes('service_restart_limit_reached'), 30_000)
    assert.equal(reached, true, 'the supervisor must stop restarting Web instead of looping forever')
    const supervisorLog = await readFile(logPath, 'utf8')
    assert.equal((supervisorLog.match(/service_exited/g) ?? []).length, WEB_RESTART_LIMIT)
    // The bound only stops the Web loop; the rest of the deployment stays up.
    await assert.doesNotReject(fetch(`http://127.0.0.1:${fixture.ports[0]}/healthz`))
  } finally {
    if (starter.exitCode === null) starter.kill('SIGKILL')
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('pid file records the supervised services and leaves no temporary behind', { timeout: 20_000 }, async () => {
  const fixture = await createFixture()
  const environment = { ...process.env, MANIFOLD_RELEASE_ROOT: fixture.root, MANIFOLD_START_TIMEOUT_MS: '5000' }
  try {
    await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    // The child PIDs are the only handle start/stop have on services whose
    // supervisor was killed without running its cleanup, so the record must
    // carry them — and carry them in a file a reader can always parse.
    assert.equal(await waitFor(async () => ((await readPidRecord(fixture.root))?.children?.length ?? 0) >= 2, 5_000), true)
    const record = await readPidRecord(fixture.root)
    assert.equal(Number.isInteger(record.pid), true)
    assert.equal(record.root, fixture.root)
    assert.equal(typeof record.token, 'string')
    for (const pid of record.children) assert.equal(isAlive(pid), true)

    assert.equal((await stat(join(fixture.root, 'run', 'manifold.pid'))).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(join(fixture.root, 'run')), ['manifold.pid'])
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('start reclaims the services a SIGKILLed supervisor left behind', { timeout: 30_000, skip: processIdentityAvailable ? false : 'process command lines cannot be read in this environment' }, async () => {
  const fixture = await createFixture()
  const environment = { ...process.env, MANIFOLD_RELEASE_ROOT: fixture.root, MANIFOLD_START_TIMEOUT_MS: '5000' }
  try {
    await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    const supervisor = await killSupervisorOnly(fixture.root)
    // Without reclamation this start dies on the port check and never recovers.
    const restarted = await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    assert.match(restarted.stdout, /Reclaimed 2 orphaned service process/)
    assert.match(restarted.stdout, /Manifold started/)
    for (const pid of supervisor.children) assert.equal(isAlive(pid), false)

    const record = await readPidRecord(fixture.root)
    assert.notEqual(record.pid, supervisor.pid)
    const status = await execute(process.execPath, [runtimePath, 'status'], { env: environment })
    assert.match(status.stdout, /Core: healthy/)
    assert.match(status.stdout, /Web: healthy/)
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('stop reclaims the services a SIGKILLed supervisor left behind', { timeout: 30_000, skip: processIdentityAvailable ? false : 'process command lines cannot be read in this environment' }, async () => {
  const fixture = await createFixture()
  const environment = { ...process.env, MANIFOLD_RELEASE_ROOT: fixture.root, MANIFOLD_START_TIMEOUT_MS: '5000' }
  try {
    await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    const supervisor = await killSupervisorOnly(fixture.root)
    // Reporting "not running" while the services still hold the ports is what
    // left operators with an orphan they could not see or stop.
    const stopped = await execute(process.execPath, [runtimePath, 'stop'], { env: environment })
    assert.match(stopped.stdout, /reclaimed 2 orphaned service process/)
    for (const pid of supervisor.children) assert.equal(isAlive(pid), false)
    for (const port of fixture.ports) await assert.rejects(fetch(`http://127.0.0.1:${port}`))
    await assert.rejects(readFile(join(fixture.root, 'run', 'manifold.pid')), /ENOENT/)
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('start replaces an unreadable pid file instead of refusing to run', { timeout: 20_000 }, async () => {
  const fixture = await createFixture()
  const environment = { ...process.env, MANIFOLD_RELEASE_ROOT: fixture.root, MANIFOLD_START_TIMEOUT_MS: '5000' }
  try {
    await mkdir(join(fixture.root, 'run'), { recursive: true })
    // A half-written record is what the previous open('wx') + writeFile sequence
    // could publish; the exclusive link() claim means this runtime cannot
    // produce one, so anything unparseable is simply stale state to replace.
    await writeFile(join(fixture.root, 'run', 'manifold.pid'), '{"pid":4242,"tok')
    const started = await execute(process.execPath, [runtimePath, 'start'], { env: environment })
    assert.match(started.stdout, /Manifold started/)
    assert.equal(Number.isInteger((await readPidRecord(fixture.root)).pid), true)
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('concurrent readers never observe a partial pid file', { timeout: 20_000 }, async () => {
  const fixture = await createFixture()
  const environment = {
    ...process.env,
    MANIFOLD_FIXTURE_WEB_EXIT_MS: '1200',
    MANIFOLD_FIXTURE_WEB_EXIT_ONCE: join(fixture.root, 'web-exit-once'),
    MANIFOLD_RELEASE_ROOT: fixture.root,
    MANIFOLD_START_TIMEOUT_MS: '5000',
  }
  try {
    // The supervisor rewrites the record on every child change, so read it hard
    // while a Web restart churns the child set. Every snapshot must be complete:
    // an unparseable read is what used to make a reader delete a live
    // supervisor's only pointer.
    const starting = execute(process.execPath, [runtimePath, 'start'], { env: environment })
    const pidPath = join(fixture.root, 'run', 'manifold.pid')
    let reads = 0
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      const source = await readFile(pidPath, 'utf8').catch(() => '')
      if (!source) continue
      assert.doesNotThrow(() => JSON.parse(source), `torn pid file: ${source}`)
      reads += 1
    }
    await starting
    assert.ok(reads > 0, 'the reader never observed the pid file')
  } finally {
    await stopFixture(fixture.root, environment)
    await rm(fixture.root, { recursive: true, force: true })
  }
})
