import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const CONTENT_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function cacheControl(pathname) {
  if (pathname === '/index.html' || pathname === '/sw.js' || pathname.endsWith('.webmanifest')) return 'no-cache'
  if (/^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[^/]+$/.test(pathname)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=3600'
}

function sendText(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  response.end(body)
}

async function regularFile(path) {
  try {
    const details = await stat(path)
    return details.isFile() ? details : null
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
    throw error
  }
}

export function createAdminServer({ root }) {
  const staticRoot = resolve(root)
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendText(response, 405, 'Method Not Allowed\n', { allow: 'GET, HEAD' })
        return
      }

      let pathname
      try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      } catch {
        sendText(response, 400, 'Bad Request\n')
        return
      }
      if (pathname.includes('\0') || pathname.includes('\\')) {
        sendText(response, 400, 'Bad Request\n')
        return
      }

      let filePath = resolve(staticRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
        sendText(response, 400, 'Bad Request\n')
        return
      }

      let details = await regularFile(filePath)
      if (!details && request.headers.accept?.includes('text/html')) {
        pathname = '/index.html'
        filePath = resolve(staticRoot, 'index.html')
        details = await regularFile(filePath)
      }
      if (!details) {
        sendText(response, 404, 'Not Found\n')
        return
      }

      response.writeHead(200, {
        'cache-control': cacheControl(pathname),
        'content-length': details.size,
        'content-type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      })
      if (request.method === 'HEAD') response.end()
      else createReadStream(filePath).pipe(response)
    } catch (error) {
      console.error('admin_static_error', error)
      if (!response.headersSent) sendText(response, 500, 'Internal Server Error\n')
      else response.destroy(error)
    }
  })
}
