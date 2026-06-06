import { useSyncExternalStore } from "react";

export type HashRoute =
  | { readonly kind: "home" }
  | { readonly kind: "kit" }
  | { readonly kind: "chat"; readonly conversationId: string }
  | { readonly kind: "project"; readonly projectId: string; readonly conversationId?: string };

/**
 * Minimal hash-router subscription. Returns the current `window.location.hash`
 * and re-renders on `hashchange`. Keeps the app dependency-free while still
 * supporting kit and workspace deep links alongside the default dashboard.
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

function decodeSegment(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function parseHashRoute(hash: string): HashRoute {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = normalized.split("/").filter((part) => part.length > 0);

  if (parts[0] === "kit") {
    return { kind: "kit" };
  }

  if (parts[0] === "chat" && parts[1]) {
    return { kind: "chat", conversationId: decodeSegment(parts[1]) };
  }

  if (parts[0] === "project" && parts[1]) {
    return {
      kind: "project",
      projectId: decodeSegment(parts[1]),
      ...(parts[2] ? { conversationId: decodeSegment(parts[2]) } : {}),
    };
  }

  return { kind: "home" };
}

export function buildHashRoute(route: HashRoute): string {
  switch (route.kind) {
    case "kit":
      return "#/kit";
    case "chat":
      return `#/chat/${encodeSegment(route.conversationId)}`;
    case "project":
      return route.conversationId
        ? `#/project/${encodeSegment(route.projectId)}/${encodeSegment(route.conversationId)}`
        : `#/project/${encodeSegment(route.projectId)}`;
    case "home":
      return "#/";
  }
}
