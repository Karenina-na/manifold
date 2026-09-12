// Focus decisions for the two modal surfaces (the image lightbox and the
// command-palette search dialog). Kept as a pure function so the wrapping rules
// can be tested without a DOM: the repo has no jsdom, and the browser-level
// behaviour is exactly this decision plus a `focus()` call.

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Which element Tab should land on inside a modal, or `null` when the browser's
// own behaviour is already correct (there is a next element inside the
// container). `current` may be an element that is not in `focusable` — focus can
// sit on the container itself — which is treated like "focus came from
// outside": the first element for Tab, the last for Shift+Tab.
export function focusWrapTarget<T>(focusable: readonly T[], current: T | null, shiftKey: boolean): T | null {
  if (focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  // A single control is the whole tab order, so both directions stay on it.
  if (focusable.length === 1) return first;
  const index = current === null ? -1 : focusable.indexOf(current);
  if (index === -1) return shiftKey ? last : first;
  if (shiftKey && index === 0) return last;
  if (!shiftKey && index === focusable.length - 1) return first;
  return null;
}
