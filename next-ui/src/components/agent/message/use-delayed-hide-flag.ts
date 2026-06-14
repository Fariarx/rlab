import { useEffect } from "react";

export function useDelayedHideFlag({
  delayMs,
  generation,
  setHidden,
}: {
  readonly delayMs: number;
  readonly generation: string;
  readonly setHidden: (hidden: boolean) => void;
}) {
  useEffect(() => {
    if (!generation) {
      setHidden(false);
      return;
    }
    setHidden(false);
    const timer = window.setTimeout(() => setHidden(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, generation, setHidden]);
}
