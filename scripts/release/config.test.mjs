import assert from 'node:assert/strict'
import test from 'node:test'

import { parseEnv, validateReleaseConfig } from './config.mjs'

const validPasswordHash = '$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8X'

const validEnvironment = {
  CORE_ENV: 'production',
  CORE_ADDR: ':8080',
  CORE_DATABASE_PATH: './data/manifold.db',
  CORE_ALLOWED_ORIGINS: 'http://203.0.113.10:3000,http://203.0.113.10:5173',
  CORE_JWT_SECRET: 'replace-with-a-long-random-secret',
  CORE_ADMIN_PASSWORD_HASH: validPasswordHash,
  CORE_PUBLIC_URL: 'http://203.0.113.10:8080',
  NEXT_PUBLIC_CORE_URL: 'http://203.0.113.10:8080',
  NEXT_PUBLIC_SITE_URL: 'http://203.0.113.10:3000',
  VITE_CORE_URL: 'http://203.0.113.10:8080',
  VITE_WEB_URL: 'http://203.0.113.10:3000',
}

test('parseEnv preserves bcrypt dollars and strips one quote layer', () => {
  const parsed = parseEnv(`
# release settings
export CORE_ENV=production
CORE_ADMIN_PASSWORD_HASH='$2a$10$abc$def'
CORE_JWT_SECRET="literal-$-secret"
`)

  assert.deepEqual(parsed, {
    CORE_ENV: 'production',
    CORE_ADMIN_PASSWORD_HASH: '$2a$10$abc$def',
    CORE_JWT_SECRET: 'literal-$-secret',
  })
})

test('parseEnv rejects malformed and duplicate entries', () => {
  assert.throws(() => parseEnv('BROKEN'), /line 1: expected KEY=VALUE/)
  assert.throws(() => parseEnv('CORE_ENV=production\nCORE_ENV=development'), /duplicate CORE_ENV/)
})

test('validateReleaseConfig derives the fixed three-port runtime manifest', () => {
  const result = validateReleaseConfig(validEnvironment)

  assert.deepEqual(result, {
    target: 'linux-x64-glibc',
    core: { host: '0.0.0.0', port: 8080, url: 'http://203.0.113.10:8080' },
    web: { host: '0.0.0.0', port: 3000, url: 'http://203.0.113.10:3000' },
    admin: { host: '0.0.0.0', port: 5173, url: 'http://203.0.113.10:5173' },
  })
})

test('validateReleaseConfig accepts distinct HTTPS origins behind a reverse proxy', () => {
  const result = validateReleaseConfig({
    ...validEnvironment,
    CORE_ALLOWED_ORIGINS: 'https://web.weizixiang.dev,https://admin.weizixiang.dev',
    CORE_PUBLIC_URL: 'https://core.weizixiang.dev',
    NEXT_PUBLIC_CORE_URL: 'https://core.weizixiang.dev',
    NEXT_PUBLIC_SITE_URL: 'https://web.weizixiang.dev',
    VITE_CORE_URL: 'https://core.weizixiang.dev',
    VITE_WEB_URL: 'https://web.weizixiang.dev',
    ADMIN_PUBLIC_URL: 'https://admin.weizixiang.dev',
  })

  assert.deepEqual(result, {
    target: 'linux-x64-glibc',
    core: { host: '0.0.0.0', port: 8080, url: 'https://core.weizixiang.dev' },
    web: { host: '0.0.0.0', port: 3000, url: 'https://web.weizixiang.dev' },
    admin: { host: '0.0.0.0', port: 5173, url: 'https://admin.weizixiang.dev' },
  })
})

test('validateReleaseConfig rejects insecure or inconsistent production settings', () => {
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_JWT_SECRET: 'manifold-dev-secret-change-me' }),
    /CORE_JWT_SECRET/,
  )
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_ADMIN_PASSWORD_HASH: '$2a$10$truncated' }),
    /CORE_ADMIN_PASSWORD_HASH/,
  )
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, NEXT_PUBLIC_CORE_URL: 'http://localhost:8080' }),
    /Core public URLs must match/,
  )
  assert.throws(
    () => validateReleaseConfig({
      ...validEnvironment,
      CORE_PUBLIC_URL: 'http://203.0.113.10',
      NEXT_PUBLIC_CORE_URL: 'http://203.0.113.10',
      VITE_CORE_URL: 'http://203.0.113.10',
    }),
    /CORE_PUBLIC_URL must use port 8080/,
  )
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_ALLOWED_ORIGINS: 'http://203.0.113.10:3000' }),
    /CORE_ALLOWED_ORIGINS must include/,
  )
  assert.throws(
    () => validateReleaseConfig({
      ...validEnvironment,
      CORE_ALLOWED_ORIGINS: 'https://web.weizixiang.dev/, https://admin.weizixiang.dev',
      CORE_PUBLIC_URL: 'https://core.weizixiang.dev',
      NEXT_PUBLIC_CORE_URL: 'https://core.weizixiang.dev',
      NEXT_PUBLIC_SITE_URL: 'https://web.weizixiang.dev',
      VITE_CORE_URL: 'https://core.weizixiang.dev',
      VITE_WEB_URL: 'https://web.weizixiang.dev',
      ADMIN_PUBLIC_URL: 'https://admin.weizixiang.dev',
    }),
    /CORE_ALLOWED_ORIGINS must contain canonical HTTP\(S\) origins/,
  )
})

test('validateReleaseConfig rejects invalid optional Core runtime values', () => {
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_ADMIN_USERNAME: '  ' }),
    /CORE_ADMIN_USERNAME/,
  )
  for (const key of ['CORE_CONTENT_CACHE_TTL', 'CORE_STATS_CACHE_TTL']) {
    assert.throws(() => validateReleaseConfig({ ...validEnvironment, [key]: 'not-a-duration' }), new RegExp(key))
  }
  for (const key of ['CORE_AUDIT_EVENT_BUFFER', 'CORE_MEDIA_MAX_BYTES', 'CORE_RATE_LIMIT_PER_MIN', 'CORE_LOGIN_RATE_LIMIT_PER_MIN']) {
    assert.throws(() => validateReleaseConfig({ ...validEnvironment, [key]: 'not-an-integer' }), new RegExp(key))
  }
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,not-a-cidr' }),
    /CORE_TRUSTED_PROXY_CIDRS/,
  )
  assert.throws(() => validateReleaseConfig({ ...validEnvironment, CORE_CONTENT_CACHE_TTL: '' }), /CORE_CONTENT_CACHE_TTL/)
  assert.throws(() => validateReleaseConfig({ ...validEnvironment, CORE_MEDIA_MAX_BYTES: '' }), /CORE_MEDIA_MAX_BYTES/)
})

test('validateReleaseConfig checks anchoring chain settings', () => {
  // Default (no chain keys) and sim mode pass untouched.
  validateReleaseConfig(validEnvironment)
  validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_PROOF_MODE: 'sim' })
  // Unknown proof modes are refused.
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_PROOF_MODE: 'ultra' }),
    /CORE_CHAIN_PROOF_MODE must be sim or proof/,
  )
  // Proof mode demands a difficulty inside the range Core accepts: below 1 the
  // target is trivial, above 6 the collision search is effectively unbounded.
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_PROOF_MODE: 'proof', CORE_CHAIN_DIFFICULTY: '0' }),
    /CORE_CHAIN_DIFFICULTY must be between 1 and 6 in proof mode/,
  )
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_PROOF_MODE: 'proof', CORE_CHAIN_DIFFICULTY: '7' }),
    /CORE_CHAIN_DIFFICULTY must be between 1 and 6 in proof mode/,
  )
  // Valid proof configuration passes.
  validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_PROOF_MODE: 'proof', CORE_CHAIN_DIFFICULTY: '4' })
  // Duration and integer keys are type-checked.
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_SIM_DELAY: 'soon' }),
    /CORE_CHAIN_SIM_DELAY/,
  )
  assert.throws(
    () => validateReleaseConfig({ ...validEnvironment, CORE_CHAIN_BATCH_SIZE: 'many' }),
    /CORE_CHAIN_BATCH_SIZE/,
  )
})
