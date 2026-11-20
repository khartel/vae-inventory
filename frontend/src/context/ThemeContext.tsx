// Light/dark/system theme context. Persists the user's preference to
// localStorage and applies the resolved "light"/"dark" class to the
// document root so Tailwind's dark-mode selector styles pick it up.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

// User-facing preference. "system" means "follow the OS setting".
type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "d-inventory:theme"

interface ThemeContextValue {
  /** The user's stored preference (may be "system"). */
  theme: Theme
  /** The concrete theme actually applied to the page ("system" already resolved). */
  resolvedTheme: "light" | "dark"
  /** Updates the preference and persists it to localStorage. */
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/** Reads the OS-level color scheme preference via a media query. */
function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/**
 * Provides theme state to the app. On mount, restores the saved preference
 * (defaulting to "light"), and whenever the preference is "system", keeps
 * `resolvedTheme` and the `<html>` class in sync with live OS theme changes
 * via a `matchMedia` change listener.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light"
  )
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? getSystemTheme() : theme
  )

  useEffect(() => {
    const root = document.documentElement
    const applied = theme === "system" ? getSystemTheme() : theme
    root.classList.remove("light", "dark")
    root.classList.add(applied)
    setResolvedTheme(applied)

    if (theme !== "system") return

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const next = getSystemTheme()
      root.classList.remove("light", "dark")
      root.classList.add(next)
      setResolvedTheme(next)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/** Accesses the theme context. Throws if called outside a `ThemeProvider`. */
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider")
  return ctx
}
