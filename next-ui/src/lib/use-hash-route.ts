import { useSyncExternalStore } from "react";

/**
 * Minimal hash-router subscription. Returns the current `window.location.hash`
 * and re-renders on `hashchange`. Keeps the app dependency-free while still
 * supporting a `#/kit` destination alongside the default dashboard.
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getSnapshot(): string {
  return window.location.hash;
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getSnapshot, () => "");
}
