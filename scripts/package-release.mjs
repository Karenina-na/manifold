import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { access, chmod, cp, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseEnv, validateReleaseConfig } from './release/config.mjs'
import { nodeVersionSupported } from './release/runtime.mjs'

const modulePath = fileURLToPath(import.meta.url)
const workspaceRoot = resolve(dirname(modulePath), '..')

export function parseArguments(argumentsList) {
  let envPath
  let outputDirectory
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--' && index === 0) continue
    if (argument === '--env' || argument === '--output') {
      const value = argumentsList[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (argument === '--env') envPath = value
      else outputDirectory = value
      index += 1
    } else if (argument.startsWith('--env=')) envPath = argument.slice('--env='.length)
    else if (argument.startsWith('--output=')) outputDirectory = argument.slice('--output='.length)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!envPath) throw new Error('--env is required')
  return { envPath, outputDirectory }
}

async function walk(root) {
  const entries = []
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      entries.push({ path, relativePath: path.slice(root.length + 1), item })
      if (item.isDirectory()) await visit(path)
    }
  }
  await visit(root)
  return entries
}

function isMachO(header) {
  if (header.length < 4) return false
  const magic = header.readUInt32BE(0)
  return [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)
}

function assertElfX64(header, label) {
  const isElf = header.length >= 20 && header[0] === 0x7f && header.subarray(1, 4).toString() === 'ELF'
  const is64Bit = header[4] === 2
  const isLittleEndian = header[5] === 1
  const isX64 = isLittleEndian && header.readUInt16LE(18) === 62
  if (!isElf || !is64Bit || !isX64) throw new Error(`${label} must be a Linux x86-64 ELF binary`)
}

async function readHeader(path) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export async function validateStagedBundle(root) {
  const requiredFiles = [
    'manifold',
    '.env',
    'release.json',
    'bin/manifold-core',
    'web/app/web/server.js',
    'admin/index.html',
    'runtime/runtime.mjs',
    'runtime/config.mjs',
    'runtime/admin-server.mjs',
  ]
  for (const relativePath of requiredFiles) {
    await access(join(root, relativePath), relativePath === 'manifold' || relativePath === 'bin/manifold-core' ? constants.X_OK : constants.R_OK)
  }
  if (((await stat(join(root, '.env'))).mode & 0o777) !== 0o600) throw new Error('.env must have mode 0600')

  const coreHeader = await readHeader(join(root, 'bin', 'manifold-core'))
  assertElfX64(coreHeader, 'bin/manifold-core')
  let nativeModules = 1
  let swcHelpersEsm = false
  let sharpLinuxX64 = false
  let sharpLibvipsLinuxX64 = false
  for (const entry of await walk(root)) {
    const name = entry.item.name.toLowerCase()
    if (entry.item.isDirectory() && name.includes('@img+sharp-libvips-linux-x64@')) sharpLibvipsLinuxX64 = true
    if (entry.item.isSymbolicLink() && entry.relativePath.startsWith('admin/')) {
      throw new Error(`Admin static files must not contain symlink ${entry.relativePath}`)
    }
    if (!entry.item.isFile()) continue
    if (entry.relativePath.endsWith('/node_modules/@swc/helpers/esm/_interop_require_default.js')) swcHelpersEsm = true
    if (/\.db(?:-shm|-wal)?$/.test(name)) throw new Error(`release must not contain database file ${entry.relativePath}`)
    if (name.endsWith('.dylib')) throw new Error(`release contains Darwin library ${entry.relativePath}`)

    const header = await readHeader(entry.path)
    if (isMachO(header)) throw new Error(`release contains Mach-O binary ${entry.relativePath}`)
    if (name.endsWith('.node') || name.endsWith('.so') || name.includes('.so.')) {
      assertElfX64(header, entry.relativePath)
      nativeModules += 1
      if (entry.relativePath.includes('@img+sharp-linux-x64@') && name.endsWith('.node')) sharpLinuxX64 = true
    }
  }
  if (!swcHelpersEsm) throw new Error('release is missing @swc/helpers ESM runtime')
  if (!sharpLinuxX64) throw new Error('release is missing @img/sharp-linux-x64 native module')
  if (!sharpLibvipsLinuxX64) throw new Error('release is missing @img/sharp-libvips-linux-x64')
  return { nativeModules }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}`))
    })
  })
}

function capture(command, args, options = {}) {
  return new Promise((resolveCapture, reject) => {
    const chunks = []
    const errorChunks = []
    const { input, ...spawnOptions } = options
    const child = spawn(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...spawnOptions })
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => errorChunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolveCapture(Buffer.concat(chunks).toString().trim())
      : reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(errorChunks).toString().trim()}`)))
    if (input !== undefined) child.stdin.end(input)
  })
}

function setEnvValue(source, key, value) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=`)
  const index = lines.findIndex((line) => pattern.test(line.trim()))
  if (index >= 0) {
    lines[index] = `${key}=${value}`
  } else {
    if (lines.at(-1) === '') lines.pop()
    lines.push(`${key}=${value}`, '')
  }
  return lines.join(newline)
}

async function writePrivateFileAtomic(path, source) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, source, { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function hashAdminPassword(password) {
  return capture('go', ['run', './cmd/password-hash'], {
    cwd: join(workspaceRoot, 'app', 'core'),
    input: password,
  })
}

export async function prepareReleaseConfig(path, dependencies = {}) {
  let source = await readFile(path, 'utf8')
  let environment = parseEnv(source)
  let generatedCredentials = null
  if (!environment.CORE_ADMIN_PASSWORD_HASH) {
    const validationHash = '$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X'
    validateReleaseConfig({ ...environment, CORE_ADMIN_PASSWORD_HASH: validationHash })

    const createPassword = dependencies.createPassword ?? (() => randomBytes(24).toString('base64url'))
    const hashPassword = dependencies.hashPassword ?? hashAdminPassword
    const password = createPassword()
    const hash = await hashPassword(password)
    source = setEnvValue(source, 'CORE_ADMIN_PASSWORD_HASH', hash)
    environment = parseEnv(source)
    const runtime = validateReleaseConfig(environment)
    await writePrivateFileAtomic(path, source)
    generatedCredentials = { username: environment.CORE_ADMIN_USERNAME || 'admin', password }
    return { source, environment, runtime, generatedCredentials }
  }
  return { source, environment, runtime: validateReleaseConfig(environment), generatedCredentials }
}

function versionAtLeast(actual, minimum) {
  const current = actual.match(/\d+(?:\.\d+){1,2}/)?.[0].split('.').map(Number) ?? []
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] ?? 0) > minimum[index]) return true
    if ((current[index] ?? 0) < minimum[index]) return false
  }
  return true
}

async function preflight() {
  if (!nodeVersionSupported()) throw new Error('Node.js >=20.9.0 is required to build a release')
  const [pnpmVersion, goVersion] = await Promise.all([
    capture('pnpm', ['--version'], { cwd: workspaceRoot }),
    capture('go', ['version'], { cwd: workspaceRoot }),
    capture('zip', ['-v'], { cwd: workspaceRoot }),
  ])
  if (!versionAtLeast(pnpmVersion, [11, 19, 0])) throw new Error('pnpm >=11.19.0 is required')
  if (!versionAtLeast(goVersion, [1, 26, 5])) throw new Error('Go >=1.26.5 is required')
}

function isNonTargetOptionalPackage(name) {
  const lowerName = name.toLowerCase()
  if (lowerName.startsWith('@img+sharp-')) {
    return !/^@img\+sharp-(?:libvips-)?linux-x64@/.test(lowerName)
  }
  if (lowerName.startsWith('sharp-')) {
    return !/^sharp-(?:libvips-)?linux-x64$/.test(lowerName)
  }
  if (lowerName.startsWith('@next+swc-')) return !lowerName.startsWith('@next+swc-linux-x64-gnu@')
  return false
}

export async function pruneNonTargetArtifacts(root) {
  const entries = await walk(root)
  const targets = entries
    .filter(({ item }) => (item.isDirectory() || item.isSymbolicLink()) && isNonTargetOptionalPackage(item.name))
    .sort((left, right) => right.path.length - left.path.length)
  for (const target of targets) await rm(target.path, { recursive: true, force: true })
}

async function copyCompleteSwcHelpers(targetWebRoot) {
  const sourcePnpmRoot = join(workspaceRoot, 'node_modules', '.pnpm')
  const targetPnpmRoot = join(targetWebRoot, 'node_modules', '.pnpm')
  const targetEntries = await readdir(targetPnpmRoot, { withFileTypes: true })
  const packageDirectories = targetEntries.filter((entry) => entry.isDirectory() && entry.name.startsWith('@swc+helpers@'))
  if (packageDirectories.length === 0) throw new Error('Next standalone is missing @swc/helpers')
  for (const entry of packageDirectories) {
    const source = join(sourcePnpmRoot, entry.name, 'node_modules', '@swc', 'helpers')
    const target = join(targetPnpmRoot, entry.name, 'node_modules', '@swc', 'helpers')
    await cp(source, target, { recursive: true, force: true })
  }
}

async function buildRelease({ envPath, outputDirectory }) {
  await preflight()
  const resolvedEnvPath = resolve(envPath)
  const { source, environment, runtime, generatedCredentials } = await prepareReleaseConfig(resolvedEnvPath)
  if (generatedCredentials) {
    console.warn('Generated initial Admin credentials because CORE_ADMIN_PASSWORD_HASH was empty.')
    console.warn(`Admin username: ${generatedCredentials.username}`)
    console.warn(`Admin password (shown once): ${generatedCredentials.password}`)
    console.warn(`Saved the bcrypt hash to ${resolvedEnvPath}; store the password securely now.`)
  }
  const commit = await capture('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: workspaceRoot })
  const releaseDirectory = resolve(outputDirectory || join(workspaceRoot, 'dist', 'releases'))
  const bundleName = `manifold-${commit}-linux-x64-glibc`
  const archivePath = join(releaseDirectory, `${bundleName}.zip`)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'manifold-release-'))
  const bundleRoot = join(temporaryRoot, bundleName)

  try {
    console.log('Installing locked dependencies for current and Linux x64 targets...')
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: workspaceRoot, env: process.env })
    console.log('Building Web and Admin with production public URLs...')
    const buildEnvironment = { ...process.env, ...environment, NODE_ENV: 'production' }
    await run('pnpm', ['--filter', '@manifold/web', 'build'], { cwd: workspaceRoot, env: buildEnvironment })
    await run('pnpm', ['--filter', '@manifold/admin', 'build'], { cwd: workspaceRoot, env: buildEnvironment })

    await Promise.all([
      mkdir(join(bundleRoot, 'bin'), { recursive: true }),
      mkdir(join(bundleRoot, 'runtime'), { recursive: true }),
      mkdir(join(bundleRoot, 'data'), { recursive: true, mode: 0o700 }),
      mkdir(join(bundleRoot, 'logs'), { recursive: true, mode: 0o700 }),
      mkdir(join(bundleRoot, 'run'), { recursive: true, mode: 0o700 }),
    ])
    console.log('Cross-compiling Core for Linux x64...')
    await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(bundleRoot, 'bin', 'manifold-core'), './cmd/server'], {
      cwd: join(workspaceRoot, 'app', 'core'),
      env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
    })

    const standaloneSource = join(workspaceRoot, 'app', 'web', '.next', 'standalone')
    await cp(standaloneSource, join(bundleRoot, 'web'), { recursive: true, verbatimSymlinks: true })
    await copyCompleteSwcHelpers(join(bundleRoot, 'web'))
    await cp(join(workspaceRoot, 'app', 'web', '.next', 'static'), join(bundleRoot, 'web', 'app', 'web', '.next', 'static'), { recursive: true })
    const webPublic = join(workspaceRoot, 'app', 'web', 'public')
    if ((await stat(webPublic).catch(() => null))?.isDirectory()) {
      await cp(webPublic, join(bundleRoot, 'web', 'app', 'web', 'public'), { recursive: true })
    }
    await cp(join(workspaceRoot, 'app', 'admin', 'dist'), join(bundleRoot, 'admin'), { recursive: true })
    for (const name of ['runtime.mjs', 'config.mjs', 'admin-server.mjs']) {
      await cp(join(workspaceRoot, 'scripts', 'release', name), join(bundleRoot, 'runtime', name))
    }
    await cp(join(workspaceRoot, 'scripts', 'release', 'manifold'), join(bundleRoot, 'manifold'))
    await chmod(join(bundleRoot, 'manifold'), 0o755)
    await chmod(join(bundleRoot, 'bin', 'manifold-core'), 0o755)
    await writeFile(join(bundleRoot, '.env'), source, { mode: 0o600 })
    await chmod(join(bundleRoot, '.env'), 0o600)
    await writeFile(join(bundleRoot, 'release.json'), `${JSON.stringify({
      schemaVersion: 1,
      commit,
      builtAt: new Date().toISOString(),
      node: '>=20.9.0',
      ...runtime,
    }, null, 2)}\n`)

    await pruneNonTargetArtifacts(join(bundleRoot, 'web'))
    const validation = await validateStagedBundle(bundleRoot)
    console.log(`Validated ${validation.nativeModules} Linux x64 native binaries.`)
    await mkdir(releaseDirectory, { recursive: true })
    await rm(archivePath, { force: true })
    await run('zip', ['-qry', archivePath, bundleName], { cwd: temporaryRoot })
    await chmod(archivePath, 0o600)
    console.log(`Release created: ${archivePath}`)
    console.warn('The archive contains production secrets from the supplied .env file; store and transfer it securely.')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  return archivePath
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  await buildRelease(options)
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    console.error(`Release failed: ${error.message}`)
    process.exitCode = 1
  })
}
