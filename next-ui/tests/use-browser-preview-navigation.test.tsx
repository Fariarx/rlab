import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserPreviewNavigation } from "../src/components/workspace/browser/use-browser-preview-navigation";
import type { BrowserSnapshot, BrowserTab, FrameHistoryState, PreviewMode } from "../src/lib/browser-preview-model";

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

interface CapturedState {
  readonly controller: ReturnType<typeof useBrowserPreviewNavigation>;
  readonly frameHistory: FrameHistoryState;
  readonly liveUrl: string | null;
  readonly mode: PreviewMode;
  readonly tabs: readonly BrowserTab[];
  readonly url: string;
  readonly userNavigationStarted: boolean;
}

function Harness({
  initialFrameHistory = { entries: [], index: -1 },
  initialLiveUrl = null,
  initialUrl = "",
  openRequest,
  postBrowserSnapshot = vi.fn(async () => snapshot()),
  serverHostOverride = "",
  syncMirror = vi.fn(async () => undefined),
  capture,
}: {
  readonly initialFrameHistory?: FrameHistoryState;
  readonly initialLiveUrl?: string | null;
  readonly initialUrl?: string;
  readonly openRequest?: { readonly url: string; readonly nonce: number };
  readonly postBrowserSnapshot?: (path: string, body: object, invalidResponseMessage: string) => Promise<BrowserSnapshot>;
  readonly serverHostOverride?: string;
  readonly syncMirror?: (targetUrl: string) => Promise<void>;
  readonly capture: (state: CapturedState) => void;
}) {
  const [activeTabId, setActiveTabId] = useState<string | null>("tab-1");
  void activeTabId;
  const [error, setError] = useState<string | null>(null);
  void error;
  const [frameHistory, setFrameHistory] = useState<FrameHistoryState>(initialFrameHistory);
  const [frameKey, setFrameKey] = useState(0);
  void frameKey;
  const [liveReplayBlocked, setLiveReplayBlocked] = useState(true);
  void liveReplayBlocked;
  const [liveUrl, setLiveUrl] = useState<string | null>(initialLiveUrl);
  const [mode, setMode] = useState<PreviewMode>("annotate");
  const [tabs, setTabs] = useState<readonly BrowserTab[]>([{ id: "tab-1", url: "https://app.test/one", title: "One", active: true }]);
  const [url, setUrl] = useState(initialUrl);
  const liveUrlRef = useRef<string | null>(initialLiveUrl);
  const userLiveNavigationStartedRef = useRef(false);
  const clearSelection = vi.fn();
  const applySnapshot = vi.fn();
  const controller = useBrowserPreviewNavigation({
    applySnapshot,
    clearSelection,
    frameHistory,
    invalidResponseMessage: "invalid",
    liveUrl,
    liveUrlRef,
    openErrorMessage: (message) => `open failed: ${message}`,
    openRequest,
    postBrowserSnapshot,
    serverHostOverride,
    sessionId: "session-1",
    setActiveTabId,
    setError,
    setFrameHistory,
    setFrameKey,
    setLiveReplayBlocked,
    setLiveUrl,
    setMode,
    setTabs,
    setUrl,
    syncMirror,
    url,
    userLiveNavigationStartedRef,
  });

  useEffect(() => {
    capture({ controller, frameHistory, liveUrl, mode, tabs, url, userNavigationStarted: userLiveNavigationStartedRef.current });
  }, [capture, controller, frameHistory, liveUrl, mode, tabs, url]);

  return null;
}

describe("useBrowserPreviewNavigation", () => {
  it("opens a target URL and resets preview navigation state", async () => {
    const syncMirror = vi.fn(async () => undefined);
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} initialUrl="http://localhost:3000/" syncMirror={syncMirror} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => {
      captured.current?.controller.openTarget("http://localhost:3000/");
    });

    await waitFor(() => expect(captured.current?.liveUrl).toBe("http://localhost:3000/"));
    expect(captured.current?.url).toBe("http://localhost:3000/");
    expect(captured.current?.mode).toBe("interact");
    expect(captured.current?.tabs).toEqual([]);
    expect(captured.current?.frameHistory.entries).toEqual(["http://localhost:3000/"]);
    expect(captured.current?.userNavigationStarted).toBe(true);
    expect(syncMirror).toHaveBeenCalledWith("http://localhost:3000/");
  });

  it("honors repeated external open requests through nonce changes", async () => {
    const syncMirror = vi.fn(async () => undefined);
    const captured: { current: CapturedState | null } = { current: null };
    const view = render(<Harness capture={(state) => { captured.current = state; }} openRequest={{ url: "https://app.test", nonce: 1 }} syncMirror={syncMirror} />);

    await waitFor(() => expect(syncMirror).toHaveBeenCalledTimes(1));
    view.rerender(<Harness capture={(state) => { captured.current = state; }} openRequest={{ url: "https://app.test", nonce: 2 }} syncMirror={syncMirror} />);

    await waitFor(() => expect(syncMirror).toHaveBeenCalledTimes(2));
    expect(captured.current?.liveUrl).toBe("https://app.test/");
  });

  it("navigates iframe history without touching parent history", async () => {
    const syncMirror = vi.fn(async () => undefined);
    const captured: { current: CapturedState | null } = { current: null };

    render(
      <Harness
        capture={(state) => { captured.current = state; }}
        initialFrameHistory={{ entries: ["https://app.test/one", "https://app.test/two"], index: 1 }}
        initialLiveUrl="https://app.test/two"
        syncMirror={syncMirror}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => {
      captured.current?.controller.navigateFrameHistory("back");
    });

    await waitFor(() => expect(captured.current?.liveUrl).toBe("https://app.test/one"));
    expect(captured.current?.frameHistory.index).toBe(0);
    expect(syncMirror).toHaveBeenCalledWith("https://app.test/one");
  });

  it("selects a server mirror tab and applies the returned snapshot", async () => {
    const next = snapshot({ activeTabId: "tab-2", url: "https://app.test/two", title: "Two" });
    const postBrowserSnapshot = vi.fn(async () => next);
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} postBrowserSnapshot={postBrowserSnapshot} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    await act(async () => {
      await captured.current?.controller.selectMirrorTab({ id: "tab-2", url: "https://app.test/two", title: "Two", active: false });
    });

    expect(postBrowserSnapshot).toHaveBeenCalledWith("/api/browser/action", { sessionId: "session-1", tabId: "tab-2", type: "select-tab" }, "invalid");
    expect(captured.current?.liveUrl).toBe("https://app.test/two");
    expect(captured.current?.url).toBe("https://app.test/two");
    expect(captured.current?.frameHistory.entries).toEqual(["https://app.test/two"]);
  });
});
