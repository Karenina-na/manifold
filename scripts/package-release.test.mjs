import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseArguments, prepareReleaseConfig, pruneNonTargetArtifacts, validateStagedBundle } from './package-release.mjs'

const generatedHash = '$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X'

function linuxElf(machine = 62) {
  const bytes = Buffer.alloc(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
  bytes.writeUInt16LE(machine, 18)
  return bytes
}

async function createBundle() {
  const root = await mkdtemp(join(tmpdir(), 'manifold-package-'))
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(root, 'web', 'app', 'web'), { recursive: true })
  await mkdir(join(root, 'web', 'node_modules', '.pnpm', '@swc+helpers@0.5.23', 'node_modules', '@swc', 'helpers', 'esm'), { recursive: true })
  await mkdir(join(root, 'web', 'node_modules', '.pnpm', '@img+sharp-linux-x64@0.35.3', 'node_modules', '@img', 'sharp-linux-x64', 'lib'), { recursive: true })
  await mkdir(join(root, 'web', 'node_modules', '.pnpm', '@img+sharp-libvips-linux-x64@1.3.2'), { recursive: true })
  await mkdir(join(root, 'admin'), { recursive: true })
  await mkdir(join(root, 'runtime'), { recursive: true })
  await writeFile(join(root, 'manifold'), '#!/bin/sh\n')
  await chmod(join(root, 'manifold'), 0o755)
  await writeFile(join(root, '.env'), 'CORE_ENV=production\n')
  await chmod(join(root, '.env'), 0o600)
  await writeFile(join(root, 'release.json'), '{}')
  await writeFile(join(root, 'bin', 'manifold-core'), linuxElf())
  await chmod(join(root, 'bin', 'manifold-core'), 0o755)
  await writeFile(join(root, 'web', 'app', 'web', 'server.js'), '')
  await writeFile(join(root, 'web', 'node_modules', '.pnpm', '@swc+helpers@0.5.23', 'node_modules', '@swc', 'helpers', 'esm', '_interop_require_default.js'), '')
  await writeFile(join(root, 'web', 'node_modules', '.pnpm', '@img+sharp-linux-x64@0.35.3', 'node_modules', '@img', 'sharp-linux-x64', 'lib', 'sharp-linux-x64.node'), linuxElf())
  await writeFile(join(root, 'admin', 'index.html'), '')
  await writeFile(join(root, 'runtime', 'runtime.mjs'), '')
  await writeFile(join(root, 'runtime', 'config.mjs'), '')
  await writeFile(join(root, 'runtime', 'admin-server.mjs'), '')
  return root
}

test('parseArguments requires an env file and accepts an output directory', () => {
  assert.deepEqual(parseArguments(['--', '--env', '.env.production']), {
    envPath: '.env.production',
    outputDirectory: undefined,
  })
  assert.deepEqual(parseArguments(['--env', '.env.production']), {
    envPath: '.env.production',
    outputDirectory: undefined,
  })
  assert.deepEqual(parseArguments(['--output', 'artifacts', '--env=config/prod.env']), {
    envPath: 'config/prod.env',
    outputDirectory: 'artifacts',
  })
  assert.throws(() => parseArguments([]), /--env is required/)
  assert.throws(() => parseArguments(['--unknown']), /Unknown argument/)
})

test('prepareReleaseConfig generates an initial admin password once and persists its hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manifold-credentials-'))
  const envPath = join(root, '.env.production')
  const source = `# production settings
CORE_ENV=production
CORE_ADDR=:8080
CORE_DATABASE_PATH=./data/manifold.db
CORE_ALLOWED_ORIGINS=http://203.0.113.10:3000,http://203.0.113.10:5173
CORE_JWT_SECRET=replace-with-a-long-random-secret
CORE_ADMIN_USERNAME=admin
CORE_ADMIN_PASSWORD_HASH=
CORE_PUBLIC_URL=http://203.0.113.10:8080
NEXT_PUBLIC_CORE_URL=http://203.0.113.10:8080
NEXT_PUBLIC_SITE_URL=http://203.0.113.10:3000
VITE_CORE_URL=http://203.0.113.10:8080
VITE_WEB_URL=http://203.0.113.10:3000
`
  await writeFile(envPath, source, { mode: 0o600 })
  let generatedPasswords = 0
  const dependencies = {
    createPassword: () => {
      generatedPasswords += 1
      return 'generated-admin-password'
    },
    hashPassword: async (password) => {
      assert.equal(password, 'generated-admin-password')
      return generatedHash
    },
  }

  try {
    const first = await prepareReleaseConfig(envPath, dependencies)
    assert.deepEqual(first.generatedCredentials, { username: 'admin', password: 'generated-admin-password' })
    assert.equal(first.environment.CORE_ADMIN_PASSWORD_HASH, generatedHash)
    assert.equal(await readFile(envPath, 'utf8'), source.replace('CORE_ADMIN_PASSWORD_HASH=', `CORE_ADMIN_PASSWORD_HASH=${generatedHash}`))
    assert.equal((await stat(envPath)).mode & 0o777, 0o600)

    const second = await prepareReleaseConfig(envPath, dependencies)
    assert.equal(second.generatedCredentials, null)
    assert.equal(second.environment.CORE_ADMIN_PASSWORD_HASH, generatedHash)
    assert.equal(generatedPasswords, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prepareReleaseConfig does not generate credentials when other production settings are invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manifold-invalid-credentials-'))
  const envPath = join(root, '.env.production')
  const source = `CORE_ENV=production
CORE_ADDR=:8080
CORE_DATABASE_PATH=./data/manifold.db
CORE_ALLOWED_ORIGINS=http://203.0.113.10:3000,http://203.0.113.10:5173
CORE_JWT_SECRET=manifold-dev-secret-change-me
CORE_ADMIN_PASSWORD_HASH=
CORE_PUBLIC_URL=http://203.0.113.10:8080
NEXT_PUBLIC_CORE_URL=http://203.0.113.10:8080
NEXT_PUBLIC_SITE_URL=http://203.0.113.10:3000
VITE_CORE_URL=http://203.0.113.10:8080
VITE_WEB_URL=http://203.0.113.10:3000
`
  await writeFile(envPath, source, { mode: 0o600 })
  let generated = false

  try {
    await assert.rejects(prepareReleaseConfig(envPath, {
      createPassword: () => {
        generated = true
        return 'must-not-be-generated'
      },
    }), /CORE_JWT_SECRET/)
    assert.equal(generated, false)
    assert.equal(await readFile(envPath, 'utf8'), source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle accepts a complete Linux x64 release', async () => {
  const root = await createBundle()
  try {
    const result = await validateStagedBundle(root)
    assert.equal(result.nativeModules, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle rejects databases and Mach-O native code', async () => {
  const root = await createBundle()
  try {
    await writeFile(join(root, 'data.db'), '')
    await assert.rejects(validateStagedBundle(root), /must not contain database file data.db/)
    await rm(join(root, 'data.db'))

    const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, ...new Array(60).fill(0)])
    await writeFile(join(root, 'web', 'node_modules', '.pnpm', '@img+sharp-linux-x64@0.35.3', 'node_modules', '@img', 'sharp-linux-x64', 'lib', 'sharp-linux-x64.node'), machO)
    await assert.rejects(validateStagedBundle(root), /Mach-O/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle rejects every SQLite extension, not just .db', async () => {
  const root = await createBundle()
  try {
    for (const name of ['data.sqlite', 'data.sqlite3', 'data.db3', 'data.sqlite-wal', 'data.db-shm']) {
      await writeFile(join(root, name), '')
      await assert.rejects(
        validateStagedBundle(root),
        (error) => error.message.includes(`must not contain database file ${name}`),
        `${name} must be rejected`,
      )
      await rm(join(root, name))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle rejects permissive secrets and non-x64 shared libraries', async () => {
  const root = await createBundle()
  try {
    await chmod(join(root, '.env'), 0o644)
    await assert.rejects(validateStagedBundle(root), /.env must have mode 0600/)
    await chmod(join(root, '.env'), 0o600)

    await writeFile(join(root, 'web', 'libwrong.so'), linuxElf(183))
    await assert.rejects(validateStagedBundle(root), /libwrong.so must be a Linux x86-64 ELF binary/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle rejects an incomplete traced @swc/helpers package', async () => {
  const root = await createBundle()
  try {
    await rm(join(root, 'web', 'node_modules', '.pnpm', '@swc+helpers@0.5.23', 'node_modules', '@swc', 'helpers', 'esm', '_interop_require_default.js'))
    await assert.rejects(validateStagedBundle(root), /release is missing @swc\/helpers ESM runtime/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateStagedBundle rejects symlinks in the Admin static root', async () => {
  const root = await createBundle()
  try {
    await symlink('../.env', join(root, 'admin', 'leak.txt'))
    await assert.rejects(validateStagedBundle(root), /Admin static files must not contain symlink admin\/leak.txt/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pruneNonTargetArtifacts removes Darwin, ARM64, and musl optional packages', async () => {
  const root = await createBundle()
  try {
    const packageRoot = join(root, 'web', 'node_modules', '.pnpm')
    for (const packageName of [
      '@img+sharp-darwin-arm64@0.35.3',
      '@img+sharp-linux-arm64@0.35.3',
      '@img+sharp-linuxmusl-x64@0.35.3',
    ]) {
      const nativeRoot = join(packageRoot, packageName, 'node_modules', '@img', packageName.split('@0.')[0], 'lib')
      await mkdir(nativeRoot, { recursive: true })
      await writeFile(join(nativeRoot, `${packageName}.node`), linuxElf())
    }

    await pruneNonTargetArtifacts(join(root, 'web'))
    const remaining = await readdir(packageRoot)
    assert.equal(remaining.some((path) => /darwin|arm64|linuxmusl/.test(path)), false)
    await validateStagedBundle(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
