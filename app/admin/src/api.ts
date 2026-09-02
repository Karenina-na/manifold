import { ManifoldClient } from '@manifold/sdk'

const coreUrl = import.meta.env.VITE_CORE_URL ?? 'http://localhost:8080'

export const webBaseUrl = import.meta.env.VITE_WEB_URL ?? 'http://localhost:3000'
export const unauthorizedEvent = 'manifold:admin-unauthorized'
export type Session = { accessToken: string; username: string; expiresAt: number }

const adminFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  if (response.status === 401) window.dispatchEvent(new Event(unauthorizedEvent))
  return response
}

export function createAdminClient(token?: string) {
  return new ManifoldClient({ baseUrl: coreUrl, token, fetch: adminFetch })
}

export function readStoredSession() {
  const raw = sessionStorage.getItem('manifold.admin.session')
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    sessionStorage.removeItem('manifold.admin.session')
    return null
  }
}

export function storeSession(session: { accessToken: string; username: string; expiresIn: number }) {
  const value = { accessToken: session.accessToken, username: session.username, expiresAt: Date.now() + session.expiresIn * 1000 }
  sessionStorage.setItem('manifold.admin.session', JSON.stringify(value))
  return value
}

export function clearSession() {
  sessionStorage.removeItem('manifold.admin.session')
}
