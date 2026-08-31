import { useEffect, useState } from 'react'
import { hasUnsavedChanges } from './dirty-guard'

export type HashRoute = { segments: string[] }

// Registered by App on mount; consulted by requestNavigate before any hash
// change that could discard an editor's unsaved state.
let navConfirm: ((to: string) => void) | null = null

export function setNavConfirm(next: ((to: string) => void) | null) {
  navConfirm = next
}

function parseHash(): HashRoute {
  const segments = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  return { segments }
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string) {
  window.location.hash = to.startsWith('#') ? to.slice(1) : to
}

// Navigation entry point that defers to the App-level confirm modal when an
// editor has unsaved changes.
export function requestNavigate(to: string) {
  if (hasUnsavedChanges() && navConfirm) {
    navConfirm(to)
    return
  }
  navigate(to)
}

// Replaces the current history entry for hash transitions that should not
// create a back step (e.g. after the first save of a new item).
export function replaceRoute(to: string) {
  window.history.replaceState(null, '', `#${to.startsWith('#') ? to.slice(1) : to}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
