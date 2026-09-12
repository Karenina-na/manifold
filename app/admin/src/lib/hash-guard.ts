// Decision logic for in-page hash navigation, kept out of the hook so it is
// testable without a DOM (the repo has no jsdom) — the same split as
// `modal-focus.ts` and `use-modal-focus.ts` in the Web workspace.

export type HashChangeDecision =
  | { action: "ignore" }
  | { action: "apply" }
  | { action: "refuse"; attempted: string }

// A hashchange can arrive from three places, and they need different handling:
//
//   - a write this module just performed (`marked`), which is already decided;
//   - the browser's back/forward controls, which move the URL behind our back;
//   - a hand-edited fragment.
//
// Only the middle case is dangerous: applying it unmounts the editor and takes
// the unsaved work with it, and `beforeunload` does not fire for an in-page hash
// change, so nothing else would have asked.
//
// `canConfirm` mirrors `requestNavigate`, which navigates freely when no confirm
// handler is registered. Refusing without a way to ask would strand the user on
// a URL that no longer matches the UI, so that case applies too.
export function decideHashChange({
  next,
  applied,
  marked,
  dirty,
  canConfirm,
}: {
  next: string
  applied: string
  marked: boolean
  dirty: boolean
  canConfirm: boolean
}): HashChangeDecision {
  if (next === applied) return { action: "ignore" }
  if (marked) return { action: "apply" }
  if (!dirty || !canConfirm) return { action: "apply" }
  return { action: "refuse", attempted: next }
}

// A mark is honoured only for the hash it was set for. A write that turned out
// to be a no-op fires no event at all, so without matching on the value a stale
// mark would arm the next genuine back/forward gesture and apply it — which is
// precisely the data loss the guard exists to prevent.
export function hashChangeIsMarked(mark: string | null, next: string): boolean {
  return mark !== null && mark === next
}

// The one place the leading `#` is normalised, so `navigate` and `replaceRoute`
// cannot disagree about what a target string means.
export function normaliseHash(to: string): string {
  return to.startsWith("#") ? to : `#${to}`
}
