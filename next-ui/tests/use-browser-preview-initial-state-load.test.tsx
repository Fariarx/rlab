import { render, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserPreviewInitialStateLoad } from "../src/components/workspace/browser/use-browser-preview-initial-state-load";
import type { BrowserSnapshot, MirrorStatus } from "../src/lib/browser-preview-model";

function snapshot(patch: Partial<BrowserSnapshot> = {}): BrowserSnapshot {
  return {
    sessionId: patch.sessionId ?? "session-1",
    activeTabId: patch.activeTabId ?? "tab-1",
    tabs: patch.tabs ?? [{ id: "tab-1", url: patch.url ?? "about:blank", title: patch.title ?? "", active: true }],
    freshness: patch.freshness ?? "synced",
    url: patch.url ?? "about:blank",
    title: patch.title ?? "",
    viewport: patch.viewport ?? { width: 800, height: 600 },
    updatedAt: patch.updatedAt ?? "2026-06-14T00:00:00.000Z",
  };
}

function Harness({
  agentNavigationUrl = null,
  bridgeActive = true,
  browserEventCursor = 0,
  loadBrowserState,
  localMirrorDirtyPending = false,
  userLiveNavigationStarted = false,
}: {
  readonly agentNavigationUrl?: string | null;
  readonly bridgeActive?: boolean;
  readonly browserEventCursor?: number;
  readonly loadBrowserState: (sessionId: string, invalidResponseMessage: string) => Promise<BrowserSnapshot | null>;
  readonly localMirrorDirtyPending?: boolean;
  readonly userLiveNavigationStarted?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("idle");
  const [adoptedUrls, setAdoptedUrls] = useState<readonly string[]>([]);
  const [applyCalls, setApplyCalls] = useState(0);
  const agentNavigationUrlRef = useRef<string | null>(agentNavigationUrl);
  const browserEventCursorRef = useRef(browserEventCursor);
  const localMirrorDirtyPendingRef = useRef(localMirrorDirtyPending);
  const userLiveNavigationStartedRef = useRef(userLiveNavigationStarted);
  const applySnapshot = useCallback(() => {
    setApplyCalls((count) => count + 1);
  }, []);
  const adoptBrowserUrl = useCallback((nextUrl: string) => {
    setAdoptedUrls((current) => [...current, nextUrl]);
  }, []);
  const openErrorMessage = useCallback((message: string) => `open failed: ${message}`, []);

  useBrowserPreviewInitialStateLoad({
    adoptBrowserUrl,
    agentNavigationUrlRef,
    applySnapshot,
    bridgeActive,
    browserEventCursorRef,
    invalidResponseMessage: "invalid",
    loadBrowserState,
    localMirrorDirtyPendingRef,
    openErrorMessage,
    sessionId: "session-1",
    setError,
    setMirrorStatus,
    userLiveNavigationStartedRef,
  });

  return (
    <output
      data-adopt-calls={adoptedUrls.join(",")}
      data-apply-calls={applyCalls}
      data-error={error ?? ""}
      data-status={mirrorStatus}
      data-testid="state"
    />
  );
}

describe("useBrowserPreviewInitialStateLoad", () => {
  it("loads browser state, applies the snapshot, and adopts the snapshot url", async () => {
    const next = snapshot({ url: "https://app.test/page" });
    const loadBrowserState = vi.fn(async () => next);

    const view = render(<Harness loadBrowserState={loadBrowserState} localMirrorDirtyPending />);

    await waitFor(() => expect(loadBrowserState).toHaveBeenCalledWith("session-1", "invalid"));
    const state = view.getByTestId("state");
    await waitFor(() => expect(state).toHaveAttribute("data-apply-calls", "1"));
    expect(state).toHaveAttribute("data-adopt-calls", "https://app.test/page");
  });

  it("prefers an agent navigation url over the loaded snapshot url", async () => {
    const loadBrowserState = vi.fn(async () => snapshot({ url: "https://app.test/snapshot" }));

    const view = render(<Harness loadBrowserState={loadBrowserState} agentNavigationUrl="https://app.test/agent" />);

    await waitFor(() => expect(view.getByTestId("state")).toHaveAttribute("data-adopt-calls", "https://app.test/agent"));
  });

  it("sets error state when the browser state request fails", async () => {
    const loadBrowserState = vi.fn(async () => {
      throw new Error("state failed");
    });

    const view = render(<Harness loadBrowserState={loadBrowserState} />);

    await waitFor(() => expect(view.getByTestId("state")).toHaveAttribute("data-status", "error"));
    expect(view.getByTestId("state")).toHaveAttribute("data-error", "open failed: state failed");
  });
});
