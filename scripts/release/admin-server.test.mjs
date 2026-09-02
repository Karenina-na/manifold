import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createAdminServer } from './admin-server.mjs'

async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), 'manifold-admin-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Admin</title>')
  await writeFile(join(root, 'assets', 'app-a1b2c3.js'), 'console.log("admin")')
  await writeFile(join(root, 'sw.js'), 'self.skipWaiting()')
  const server = createAdminServer({ root })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}

test('serves hashed assets with content type and immutable caching', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/assets/app-a1b2c3.js`)

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/javascript/)
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(await response.text(), 'console.log("admin")')
  })
})

test('supports HEAD and prevents stale service workers', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/sw.js`, { method: 'HEAD' })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength('self.skipWaiting()')))
  })
})

test('falls back to index.html for browser navigation', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/writings/entry`, { headers: { accept: 'text/html' } })

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    assert.match(await response.text(), /<title>Admin<\/title>/)
  })
})

test('rejects encoded path traversal and unsupported methods', async () => {
  await withServer(async (origin) => {
    const traversal = await fetch(`${origin}/..%2Fsecret.txt`)
    const post = await fetch(origin, { method: 'POST' })

    assert.equal(traversal.status, 400)
    assert.equal(post.status, 405)
    assert.equal(post.headers.get('allow'), 'GET, HEAD')
  })
})
