// Lets App-level navigation (sidebar, back links) check for unsaved editor
// state without threading form state through every component.
let guard: (() => boolean) | null = null

export function setDirtyGuard(next: (() => boolean) | null) {
  guard = next
}

export function hasUnsavedChanges(): boolean {
  return guard ? guard() : false
}
