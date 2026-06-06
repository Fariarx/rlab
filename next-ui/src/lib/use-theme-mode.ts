import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "rlab-ui-kit-theme";

function readStored(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

/** Theme-mode state for the kit, persisted to localStorage. */
export function useThemeMode(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(readStored);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggle = useCallback(() => setMode((current) => (current === "dark" ? "light" : "dark")), []);

  return { mode, setMode, toggle };
}
