// Lets App-level navigation (sidebar, back links) check for unsaved editor
// state without threading form state through every component.
let guard: (() => boolean) | null = null

export function setDirtyGuard(next: (() => boolean) | null) {
  guard = next
}

export function hasUnsavedChanges(): boolean {
  return guard ? guard() : false
}

// In-app navigation funnels through `requestNavigate`, which can open the
// confirm modal. A reload, a tab close and a browser back gesture never reach
// that code path, so without this listener the editor's unsaved work vanishes
// with no prompt at all. The browser draws its own generic dialog; calling
// `preventDefault` is what arms it, and `returnValue` is kept for engines that
// still read it.
export function beforeUnloadHandler(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges()) return
  event.preventDefault()
  event.returnValue = ""
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", beforeUnloadHandler)
}
