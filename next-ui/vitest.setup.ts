import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

function installJsdomStorageWhenNodeStorageLeaks(): void {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem === "function") {
    return;
  }

  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

installJsdomStorageWhenNodeStorageLeaks();

// Integration tests render the full MUI + react-virtuoso tree; under full-suite
// load a single async assertion can legitimately exceed RTL's 1s default. Give
// `waitFor`/`findBy*` more headroom so timing-sensitive suites stay deterministic.
configure({ asyncUtilTimeout: 5000 });
