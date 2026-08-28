/**
 * @nexora/app-web — color-scheme mode (light / dark).
 *
 * The authenticated shell is designed light-first (`:root` default tokens);
 * this provider lets a signed-in user opt into the design system's dark
 * palette (`[data-theme="dark"]`) and remembers the choice. The attribute is
 * written to `<html>` so every `var(--nexora-*)` lookup switches at once —
 * the same mechanism the Login scene uses locally.
 *
 * A tiny inline script in `index.html` applies the persisted value before
 * first paint; this provider keeps it in sync afterwards and exposes the
 * toggle to the shell.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** The two color-scheme modes the authenticated shell supports. */
export type ThemeMode = 'light' | 'dark';

/** `localStorage` key — shared with the pre-paint script in `index.html`. */
export const THEME_MODE_STORAGE_KEY = 'nexora-theme';

/** The value exposed to the authenticated app tree. */
export interface ThemeModeValue {
  /** The active mode. */
  mode: ThemeMode;
  /** Sets the mode explicitly (persisted). */
  setMode: (mode: ThemeMode) => void;
  /** Flips light ⇄ dark (persisted). */
  toggle: () => void;
}

const ThemeModeContext = createContext<ThemeModeValue | null>(null);

/** Reads the persisted mode, defaulting to light (the shell's design intent). */
function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  try {
    return window.localStorage.getItem(THEME_MODE_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Reflects the mode onto `<html data-theme>` (removed entirely when light). */
function applyMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

/** Props of {@link ThemeModeProvider}. */
export interface ThemeModeProviderProps {
  children: ReactNode;
}

/** Provides the color-scheme mode + toggle to the authenticated app tree. */
export function ThemeModeProvider({ children }: ThemeModeProviderProps): JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());

  useEffect(() => {
    applyMode(mode);
    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // Private-mode / storage-disabled: the attribute still applied above.
    }
  }, [mode]);

  // Another tab changed the preference — mirror it here.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === THEME_MODE_STORAGE_KEY) {
        setModeState(event.newValue === 'dark' ? 'dark' : 'light');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const toggle = useCallback(() => setModeState((prev) => (prev === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo<ThemeModeValue>(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

/**
 * Reads the color-scheme mode. Falls back to a no-op light value when no
 * provider is mounted (e.g. isolated component tests) so callers never crash.
 */
export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (value !== null) {
    return value;
  }
  return {
    mode: 'light',
    setMode: () => undefined,
    toggle: () => undefined,
  };
}
