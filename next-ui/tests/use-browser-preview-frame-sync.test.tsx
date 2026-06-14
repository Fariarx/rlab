import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrowserPreviewFrameSync } from "../src/components/workspace/browser/use-browser-preview-frame-sync";
import type { BrowserSnapshot, FrameHistoryState, MirrorStatus } from "../src/lib/browser-preview-model";

function storageFromRecord(items: Record<string, string>): Storage {
  const entries = Object.entries(items);
  return {
    get length() {
      return entries.length;
    },
    clear: vi.fn(),
    getItem: vi.fn((key: string) => items[key] ?? null),
    key: vi.fn((index: number) => entries[index]?.[0] ?? null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };
}

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

function frameWindow(url: string): Window {
  const frameDocument = document.implementation.createHTMLDocument("frame");
  return Object.assign(new EventTarget(), {
    document: frameDocument,
    location: { href: url },
    localStorage: storageFromRecord({ theme: "dark" }),
    sessionStorage: storageFromRecord({ step: "one" }),
  }) as unknown as Window;
}

interface CapturedController {
  readonly frame: HTMLIFrameElement | null;
  readonly handleFrameLoad: () => void;
  readonly markMirrorDirty: (reason: string, dirtyUrl?: string) => Promise<void>;
  readonly syncMirror: (targetUrl: string) => Promise<void>;
}

function Harness({
  active = true,
  liveUrl = "https://app.test/page",
  mirrorStatus = "idle",
  postBrowserSnapshot,
  capture,
}: {
  readonly active?: boolean;
  readonly liveUrl?: string | null;
  readonly mirrorStatus?: MirrorStatus;
  readonly postBrowserSnapshot: (path: string, body: object, invalidResponseMessage: string) => Promise<BrowserSnapshot>;
  readonly capture: (controller: CapturedController) => void;
}) {
  const [frameHistory, setFrameHistory] = useState<FrameHistoryState>({ entries: [], index: -1 });
  void frameHistory;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const liveUrlRef = useRef<string | null>(liveUrl);
  liveUrlRef.current = liveUrl;
  const localMirrorDirtyPendingRef = useRef(false);
  const suppressFrameDirtyUntilRef = useRef(0);
  const controller = useBrowserPreviewFrameSync({
    active,
    applySnapshot: vi.fn(),
    frameRef,
    invalidResponseMessage: "invalid",
    liveUrl,
    liveUrlRef,
    localMirrorDirtyPendingRef,
    mirrorStatus,
    openErrorMessage: (error) => `open failed: ${error}`,
    postBrowserSnapshot,
    sessionId: "session-1",
    setError: vi.fn(),
    setFrameHistory,
    setLiveReplayBlocked: vi.fn(),
    setLiveUrl: vi.fn(),
    setMirrorStatus: vi.fn(),
    setUrl: vi.fn(),
    suppressFrameDirtyUntilRef,
  });

  useEffect(() => {
    capture({ frame: frameRef.current, ...controller });
  }, [capture, controller]);

  return <iframe ref={frameRef} title="preview" />;
}

describe("useBrowserPreviewFrameSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces dirty mirror auto-sync", async () => {
    vi.useFakeTimers();
    const postBrowserSnapshot = vi.fn(async () => snapshot({ url: "https://app.test/page" }));

    render(<Harness mirrorStatus="dirty" postBrowserSnapshot={postBrowserSnapshot} capture={vi.fn()} />);

    expect(postBrowserSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(postBrowserSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(postBrowserSnapshot).toHaveBeenCalledWith("/api/browser/sync", expect.objectContaining({ sessionId: "session-1", url: "https://app.test/page" }), "invalid");
  });

  it("marks iframe navigation dirty and records the navigated URL", async () => {
    const postBrowserSnapshot = vi.fn(async () => snapshot({ url: "https://app.test/new" }));
    const captured: { current: CapturedController | null } = { current: null };

    render(
      <Harness
        liveUrl="https://app.test/old"
        postBrowserSnapshot={postBrowserSnapshot}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() => expect(captured.current?.frame).toBeInstanceOf(HTMLIFrameElement));
    Object.defineProperty(captured.current?.frame, "contentWindow", {
      configurable: true,
      value: frameWindow("https://app.test/new"),
    });

    act(() => {
      captured.current?.handleFrameLoad();
    });

    await waitFor(() => expect(postBrowserSnapshot).toHaveBeenCalledWith("/api/browser/dirty", { sessionId: "session-1", reason: "iframe navigation", url: "https://app.test/new" }, "invalid"));
  });

  it("attaches frame dirty listeners and posts user-generated dirtiness", async () => {
    const postBrowserSnapshot = vi.fn(async () => snapshot({ url: "https://app.test/page" }));
    const captured: { current: CapturedController | null } = { current: null };

    render(
      <Harness
        liveUrl="https://app.test/page"
        postBrowserSnapshot={postBrowserSnapshot}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() => expect(captured.current?.frame).toBeInstanceOf(HTMLIFrameElement));
    const win = frameWindow("https://app.test/page");
    Object.defineProperty(captured.current?.frame, "contentWindow", {
      configurable: true,
      value: win,
    });

    act(() => {
      captured.current?.handleFrameLoad();
      win.document.dispatchEvent(new Event("click"));
    });

    await waitFor(() => expect(postBrowserSnapshot).toHaveBeenCalledWith("/api/browser/dirty", { sessionId: "session-1", reason: "iframe click", url: "https://app.test/page" }, "invalid"));
  });
});
