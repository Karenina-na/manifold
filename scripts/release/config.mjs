import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'

const DEV_JWT_SECRET = 'manifold-dev-secret-change-me'
const DEV_PASSWORD_HASH = '$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W'
const REQUIRED_KEYS = [
  'CORE_ENV',
  'CORE_ADDR',
  'CORE_DATABASE_PATH',
  'CORE_ALLOWED_ORIGINS',
  'CORE_JWT_SECRET',
  'CORE_ADMIN_PASSWORD_HASH',
  'CORE_PUBLIC_URL',
  'NEXT_PUBLIC_CORE_URL',
  'NEXT_PUBLIC_SITE_URL',
  'VITE_CORE_URL',
  'VITE_WEB_URL',
]
const DURATION_KEYS = ['CORE_CONTENT_CACHE_TTL', 'CORE_STATS_CACHE_TTL', 'CORE_CHAIN_SIM_DELAY', 'CORE_CHAIN_FLUSH_TIMEOUT']
const INTEGER_KEYS = [
  'CORE_AUDIT_EVENT_BUFFER',
  'CORE_MEDIA_MAX_BYTES',
  'CORE_RATE_LIMIT_PER_MIN',
  'CORE_LOGIN_RATE_LIMIT_PER_MIN',
  'CORE_CHAIN_DIFFICULTY',
  'CORE_CHAIN_BATCH_SIZE',
  'CORE_CHAIN_MAX_BLOCK_ANCHORS',
  'CORE_CHAIN_ANCHOR_MAX_BYTES',
]
const GO_DURATION = /^[+-]?(?:0|(?:\d+(?:\.\d+)?(?:ns|us|ms|s|m|h))+)$/

export function parseEnv(source) {
  const values = {}
  for (const [index, rawLine] of source.split('\n').entries()) {
    let line = rawLine.replace(/\r$/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7)

    const separator = line.indexOf('=')
    if (separator === -1) throw new Error(`line ${index + 1}: expected KEY=VALUE`)

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`line ${index + 1}: invalid variable name`)
    if (Object.hasOwn(values, key)) throw new Error(`line ${index + 1}: duplicate ${key}`)
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function releaseUrl(value, key, expectedPort) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${key} must be an absolute HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    throw new Error(`${key} must be an HTTP(S) origin without credentials, path, query, or fragment`)
  }
  if (expectedPort && url.port !== String(expectedPort)) throw new Error(`${key} must use port ${expectedPort}`)
  return url
}

function validCIDR(value) {
  const separator = value.lastIndexOf('/')
  if (separator <= 0) return false
  const address = value.slice(0, separator)
  const prefix = value.slice(separator + 1)
  const version = isIP(address)
  if (!version || !/^\d+$/.test(prefix)) return false
  return Number(prefix) <= (version === 4 ? 32 : 128)
}

export function validateReleaseConfig(environment) {
  for (const key of REQUIRED_KEYS) {
    if (!environment[key]) throw new Error(`${key} is required`)
  }
  if (environment.CORE_ENV !== 'production') throw new Error('CORE_ENV must be production')
  if (Object.hasOwn(environment, 'CORE_ADMIN_USERNAME') && !environment.CORE_ADMIN_USERNAME.trim()) {
    throw new Error('CORE_ADMIN_USERNAME must not be empty')
  }
  for (const key of DURATION_KEYS) {
    if (Object.hasOwn(environment, key) && !GO_DURATION.test(environment[key])) throw new Error(`${key} must be a Go duration`)
  }
  for (const key of INTEGER_KEYS) {
    if (Object.hasOwn(environment, key) && !/^\d+$/.test(environment[key])) throw new Error(`${key} must be a non-negative integer`)
  }
  if (environment.CORE_TRUSTED_PROXY_CIDRS) {
    for (const value of environment.CORE_TRUSTED_PROXY_CIDRS.split(',').map((item) => item.trim())) {
      if (!validCIDR(value)) throw new Error(`CORE_TRUSTED_PROXY_CIDRS contains invalid CIDR ${value}`)
    }
  }
  if (environment.CORE_ADDR !== ':8080') throw new Error('CORE_ADDR must be :8080')
  if (environment.CORE_DATABASE_PATH !== './data/manifold.db') {
    throw new Error('CORE_DATABASE_PATH must be ./data/manifold.db')
  }
  if (environment.CORE_SEED_FILE) throw new Error('CORE_SEED_FILE must be empty for this release package')
  if (environment.CORE_JWT_SECRET === DEV_JWT_SECRET || environment.CORE_JWT_SECRET.length < 16) {
    throw new Error('CORE_JWT_SECRET must be a non-default secret of at least 16 characters')
  }
  if (Object.hasOwn(environment, 'CORE_CHAIN_PROOF_MODE')
    && !['sim', 'proof'].includes(environment.CORE_CHAIN_PROOF_MODE)) {
    throw new Error('CORE_CHAIN_PROOF_MODE must be sim or proof')
  }
  if (environment.CORE_CHAIN_PROOF_MODE === 'proof' && Number(environment.CORE_CHAIN_DIFFICULTY) < 1) {
    throw new Error('CORE_CHAIN_DIFFICULTY must be >= 1 in proof mode')
  }
  if (environment.CORE_ADMIN_PASSWORD_HASH === DEV_PASSWORD_HASH
    || !/^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(environment.CORE_ADMIN_PASSWORD_HASH)) {
    throw new Error('CORE_ADMIN_PASSWORD_HASH must be a non-default bcrypt hash')
  }

  const reverseProxyMode = Boolean(environment.ADMIN_PUBLIC_URL)
  const coreUrl = releaseUrl(environment.CORE_PUBLIC_URL, 'CORE_PUBLIC_URL', reverseProxyMode ? undefined : 8080)
  const nextCoreUrl = releaseUrl(environment.NEXT_PUBLIC_CORE_URL, 'NEXT_PUBLIC_CORE_URL', reverseProxyMode ? undefined : 8080)
  const viteCoreUrl = releaseUrl(environment.VITE_CORE_URL, 'VITE_CORE_URL', reverseProxyMode ? undefined : 8080)
  if (coreUrl.origin !== nextCoreUrl.origin || coreUrl.origin !== viteCoreUrl.origin) {
    throw new Error('Core public URLs must match')
  }

  const webUrl = releaseUrl(environment.NEXT_PUBLIC_SITE_URL, 'NEXT_PUBLIC_SITE_URL', reverseProxyMode ? undefined : 3000)
  const viteWebUrl = releaseUrl(environment.VITE_WEB_URL, 'VITE_WEB_URL', reverseProxyMode ? undefined : 3000)
  if (webUrl.origin !== viteWebUrl.origin) throw new Error('Web public URLs must match')
  if (!reverseProxyMode && coreUrl.hostname !== webUrl.hostname) throw new Error('Core and Web public URLs must use the same host')

  let adminUrl
  if (reverseProxyMode) {
    adminUrl = releaseUrl(environment.ADMIN_PUBLIC_URL, 'ADMIN_PUBLIC_URL')
  } else {
    adminUrl = new URL(webUrl.origin)
    adminUrl.port = '5173'
  }
  for (const url of [coreUrl, webUrl, adminUrl]) {
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Public URLs must not use localhost')
  }
  const allowedOrigins = new Set()
  for (const value of environment.CORE_ALLOWED_ORIGINS.split(',')) {
    let url
    try {
      url = releaseUrl(value, 'CORE_ALLOWED_ORIGINS entry')
    } catch {
      throw new Error('CORE_ALLOWED_ORIGINS must contain canonical HTTP(S) origins')
    }
    if (value !== url.origin) throw new Error('CORE_ALLOWED_ORIGINS must contain canonical HTTP(S) origins')
    allowedOrigins.add(value)
  }
  for (const origin of [webUrl.origin, adminUrl.origin]) {
    if (!allowedOrigins.has(origin)) throw new Error(`CORE_ALLOWED_ORIGINS must include ${origin}`)
  }

  return {
    target: 'linux-x64-glibc',
    core: { host: '0.0.0.0', port: 8080, url: coreUrl.origin },
    web: { host: '0.0.0.0', port: 3000, url: webUrl.origin },
    admin: { host: '0.0.0.0', port: 5173, url: adminUrl.origin },
  }
}

export async function loadReleaseConfig(path) {
  const source = await readFile(path, 'utf8')
  const environment = parseEnv(source)
  return { source, environment, runtime: validateReleaseConfig(environment) }
}
