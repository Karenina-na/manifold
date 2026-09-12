"use client";

// Holds the active theme for the app shell so the nav toggle and the Radix
// `Theme` wrapper cannot drift apart. The DOM attribute itself is set by the
// blocking script in the root layout; this provider only mirrors it into React.
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { applyTheme, readCurrentTheme, subscribeToTheme, type ThemeName } from "../lib/theme";

type ThemeContextValue = { theme: ThemeName; toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

// The stored theme is external state (a DOM attribute plus `localStorage`), so
// it is read through `useSyncExternalStore` rather than mirrored into `useState`
// from an effect. The server snapshot is always "light", which is also what the
// server renders, so hydration matches and the real value arrives in the
// post-hydration re-render instead of as a mismatch warning.
const serverTheme = () => "light" as ThemeName;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, readCurrentTheme, serverTheme);
  const toggleTheme = useCallback(() => {
    applyTheme(readCurrentTheme() === "dark" ? "light" : "dark");
  }, []);
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider");
  return value;
}
