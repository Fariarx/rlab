import { useEffect, useState } from "react";
import { elapsedSecondsSince } from "./message-display-model";

export function useLiveElapsedSeconds({
  active,
  startedAtMs,
  now = Date.now,
}: {
  readonly active: boolean;
  readonly startedAtMs?: number;
  readonly now?: () => number;
}): number | null {
  const [tick, setTick] = useState(0);
  void tick;

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  return active ? elapsedSecondsSince(startedAtMs, now()) : null;
}
