// Single source of truth for the colour theme.
//
// The stored preference is applied to `document.documentElement` by a blocking
// inline script before first paint (see `themeInitScript`), and React reads it
// back through `useSyncExternalStore`. Both halves must agree, so the storage
// key, the event name and the "anything that is not dark is light"
// normalisation live here instead of being repeated per component.
export type ThemeName = "light" | "dark";

export const THEME_STORAGE_KEY = "manifold.theme";

// A `localStorage` write is invisible to listeners inside the same tab, so
// writers also dispatch this event and the provider subscribes to it.
export const THEME_EVENT = "manifold:theme";

export function normalizeTheme(value: string | null | undefined): ThemeName {
  return value === "dark" ? "dark" : "light";
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persisting is best effort; the DOM attribute already applied.
  }
  window.dispatchEvent(new CustomEvent<ThemeName>(THEME_EVENT, { detail: theme }));
}

// The DOM attribute — not `localStorage` — is the source of truth once the
// blocking script has run, because the REPL `theme` command also writes it.
export function readCurrentTheme(): ThemeName {
  if (typeof document === "undefined") return "light";
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_EVENT, onStoreChange);
}

// Runs before the first paint so a dark-mode reader never sees the light
// palette. It is deliberately a plain string: it has to be inline and ahead of
// the app bundle, and it must not depend on any module being loaded yet.
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=t==="dark"?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
