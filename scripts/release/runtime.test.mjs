import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import { nodeVersionSupported } from './runtime.mjs'

const execute = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const runtimePath = resolve(here, 'runtime.mjs')

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
