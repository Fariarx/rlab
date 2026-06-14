import { useEffect } from "react";

export interface UseCommandPaletteShortcutInput {
  readonly setCommandPaletteOpen: (open: boolean) => void;
  readonly target?: Window;
}

export function useCommandPaletteShortcut({ setCommandPaletteOpen, target }: UseCommandPaletteShortcutInput): void {
  const eventTarget = target ?? (typeof window === "undefined" ? null : window);

  useEffect(() => {
    if (!eventTarget) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    eventTarget.addEventListener("keydown", onKeyDown);
    return () => eventTarget.removeEventListener("keydown", onKeyDown);
  }, [eventTarget, setCommandPaletteOpen]);
}
