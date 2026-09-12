import { useEffect, useState } from 'react'
import { hasUnsavedChanges } from './dirty-guard'
import { decideHashChange, hashChangeIsMarked, normaliseHash } from './hash-guard'

export type HashRoute = { segments: string[]; query: URLSearchParams }

// Registered by App on mount; consulted by requestNavigate before any hash
// change that could discard an editor's unsaved state.
let navConfirm: ((to: string) => void) | null = null

export function setNavConfirm(next: ((to: string) => void) | null) {
  navConfirm = next
}

function parseHash(): HashRoute {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  return { segments, query: new URLSearchParams(queryPart ?? '') }
}

function currentHash(): string {
  return window.location.hash || '#/'
}

// The hash the mounted UI was last rendered for. A back/forward gesture moves
// window.location.hash without going through any helper here, so this is the
// only record of where the UI still is — and therefore the only thing the guard
// can put the URL back to.
let appliedHash = typeof window === 'undefined' ? '#/' : currentHash()

// The hash one of our own writes is about to produce, consumed by the
// hashchange it triggers. Matching on the value rather than on a bare boolean
// keeps a no-op write from arming the next back/forward gesture; see
// hash-guard.ts for why that matters.
let markedHash: string | null = null

function writeHash(hash: string) {
  if (currentHash() === hash) return
  markedHash = hash
  window.location.hash = hash.slice(1)
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => {
      const next = currentHash()
      const decision = decideHashChange({
        next,
        applied: appliedHash,
        marked: hashChangeIsMarked(markedHash, next),
        dirty: hasUnsavedChanges(),
        canConfirm: navConfirm !== null,
      })
      markedHash = null
      if (decision.action === 'ignore') return
      if (decision.action === 'apply') {
        appliedHash = next
        setRoute(parseHash())
        return
      }
      // A back/forward gesture made while an editor is dirty: put the URL back
      // where the mounted UI still is, then offer the same confirm modal in-app
      // navigation uses. replaceState fires no hashchange, so this cannot loop;
      // assigning location.hash would push a history entry and bounce.
      window.history.replaceState(null, '', appliedHash)
      if (navConfirm) navConfirm(decision.attempted)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string) {
  writeHash(normaliseHash(to))
}

// Navigation entry point that defers to the App-level confirm modal when an
// editor has unsaved changes.
export function requestNavigate(to: string) {
  if (hasUnsavedChanges() && navConfirm) {
    navConfirm(normaliseHash(to))
    return
  }
  navigate(to)
}

// Replaces the current history entry for hash transitions that should not
// create a back step (e.g. after the first save of a new item). The synthetic
// event is marked so the guard applies it instead of reading it as a
// back/forward gesture — this can fire while the editor is dirty.
export function replaceRoute(to: string) {
  const hash = normaliseHash(to)
  window.history.replaceState(null, '', hash)
  markedHash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
