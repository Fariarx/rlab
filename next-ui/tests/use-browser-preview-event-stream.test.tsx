import { act, render, waitFor } from "@testing-library/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrowserPreviewEventStream } from "../src/components/workspace/browser/use-browser-preview-event-stream";
import type { BrowserActivityEvent, BrowserSnapshot, EventStreamStatus } from "../src/lib/browser-preview-model";

const originalEventSource = globalThis.EventSource;
const noopAdoptBrowserUrl = () => undefined;
const noopApplySnapshot = () => undefined;
const noopLoadBrowserState = async () => null;
const defaultReplayBrowserActivityEvent = () => true;
const defaultIsReplayableBrowserActivityEvent = (event: BrowserActivityEvent) => event.type === "action.click";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly close = vi.fn();
  readonly url: string | URL;
  readonly listeners = new Map<string, Set<EventListener>>();
  onerror: (() => void) | null = null;

  constructor(url: string | URL) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emitBrowser(data: unknown): void {
    const event = new MessageEvent("browser", { data: typeof data === "string" ? data : JSON.stringify(data) });
    for (const listener of this.listeners.get("browser") ?? []) {
      listener(event);
    }
  }
}

function browserEvent(patch: Partial<BrowserActivityEvent> = {}): BrowserActivityEvent {
  return {
    id: patch.id ?? 1,
    sessionId: patch.sessionId ?? "session-1",
    tabId: patch.tabId ?? "tab-1",
    type: patch.type ?? "action.click",
    label: patch.label ?? "Click",
    at: patch.at ?? "2026-06-14T00:00:00.000Z",
    ...patch,
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
    ...(patch.latestEvent ? { latestEvent: patch.latestEvent } : {}),
  };
}

interface CapturedState {
  readonly events: readonly BrowserActivityEvent[];
  readonly status: EventStreamStatus;
  readonly blocked: boolean;
  readonly currentSnapshot: BrowserSnapshot | null;
  readonly cursor: number;
}

function Harness({
  bridgeActive = true,
  loadBrowserState = noopLoadBrowserState,
  replayBrowserActivityEvent = defaultReplayBrowserActivityEvent,
  isReplayableBrowserActivityEvent = defaultIsReplayableBrowserActivityEvent,
  adoptBrowserUrl = noopAdoptBrowserUrl,
  applySnapshotSpy = noopApplySnapshot,
  capture,
}: {
  readonly bridgeActive?: boolean;
  readonly loadBrowserState?: (sessionId: string, invalidResponseMessage: string) => Promise<BrowserSnapshot | null>;
  readonly replayBrowserActivityEvent?: (frame: HTMLIFrameElement | null, event: BrowserActivityEvent) => boolean;
  readonly isReplayableBrowserActivityEvent?: (event: BrowserActivityEvent) => boolean;
  readonly adoptBrowserUrl?: (nextUrl: string) => void;
  readonly applySnapshotSpy?: (next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => void;
  readonly capture: (state: CapturedState) => void;
}) {
  const [events, setEvents] = useState<readonly BrowserActivityEvent[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>("idle");
  const [blocked, setBlocked] = useState(false);
  const [currentSnapshot, setSnapshot] = useState<BrowserSnapshot | null>(snapshot());
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const cursorRef = useRef(0);
  const suppressRef = useRef(0);
  const dirtyRef = useRef(false);
  const navigationUrlRef = useRef<string | null>(null);
  const applySnapshot = useCallback((next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => {
    applySnapshotSpy(next, options);
    setSnapshot(next);
  }, [applySnapshotSpy]);

  useBrowserPreviewEventStream({
    adoptBrowserUrl,
    applySnapshot,
    bridgeActive,
    browserEventCursorRef: cursorRef,
    frameRef,
    invalidResponseMessage: "invalid",
    isReplayableBrowserActivityEvent,
    liveReplaySuppressionUntilRef: suppressRef,
    loadBrowserState,
    localMirrorDirtyPendingRef: dirtyRef,
    navigationUrlRef,
    replayBrowserActivityEvent,
    sessionId: "session-1",
    setActivityEvents: setEvents,
    setEventStreamStatus: setStatus,
    setLiveReplayBlocked: setBlocked,
    setSnapshot,
  });

  useEffect(() => {
    capture({ blocked, currentSnapshot, cursor: cursorRef.current, events, status });
  }, [blocked, capture, currentSnapshot, events, status]);

  return <iframe ref={frameRef} title="preview" />;
}

describe("useBrowserPreviewEventStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.EventSource = originalEventSource;
    MockEventSource.instances = [];
  });

  it("connects to the session stream and closes it on unmount", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const capture = vi.fn();

    const view = render(<Harness capture={capture} />);

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    expect(String(MockEventSource.instances[0]?.url)).toBe("/api/browser/events?sessionId=session-1");
    await waitFor(() => expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({ status: "connected" })));

    view.unmount();

    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("applies navigation event effects and replay status", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const adoptBrowserUrl = vi.fn();
    const replayBrowserActivityEvent = vi.fn(() => false);
    const latest: { current: CapturedState | null } = { current: null };

    render(
      <Harness
        adoptBrowserUrl={adoptBrowserUrl}
        capture={(state) => {
          latest.current = state;
        }}
        replayBrowserActivityEvent={replayBrowserActivityEvent}
      />,
    );

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      MockEventSource.instances[0]?.emitBrowser(browserEvent({ id: 4, type: "navigation.done", url: "https://app.test/page", title: "App" }));
    });

    await waitFor(() => expect(latest.current?.events.map((event) => event.id)).toEqual([4]));
    expect(latest.current?.cursor).toBe(4);
    expect(latest.current?.blocked).toBe(false);
    expect(latest.current?.currentSnapshot).toMatchObject({ title: "App", url: "https://app.test/page" });
    expect(adoptBrowserUrl).toHaveBeenCalledWith("https://app.test/page");
    expect(replayBrowserActivityEvent).not.toHaveBeenCalled();
  });

  it("marks replay blocked when a replayable event cannot be applied", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const replayBrowserActivityEvent = vi.fn(() => false);
    const latest: { current: CapturedState | null } = { current: null };

    render(
      <Harness
        capture={(state) => {
          latest.current = state;
        }}
        replayBrowserActivityEvent={replayBrowserActivityEvent}
      />,
    );

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      MockEventSource.instances[0]?.emitBrowser(browserEvent({ id: 2, type: "action.click" }));
    });

    await waitFor(() => expect(latest.current?.blocked).toBe(true));
    expect(replayBrowserActivityEvent).toHaveBeenCalledTimes(1);
  });

  it("does not replay stale events that were already applied", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const replayBrowserActivityEvent = vi.fn(() => true);
    const latest: { current: CapturedState | null } = { current: null };

    render(
      <Harness
        capture={(state) => {
          latest.current = state;
        }}
        replayBrowserActivityEvent={replayBrowserActivityEvent}
      />,
    );

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      MockEventSource.instances[0]?.emitBrowser(browserEvent({ id: 5, type: "action.click" }));
    });
    await waitFor(() => expect(latest.current?.cursor).toBe(5));

    act(() => {
      MockEventSource.instances[0]?.emitBrowser(browserEvent({ id: 5, type: "action.click" }));
    });

    expect(latest.current?.events.map((event) => event.id)).toEqual([5]);
    expect(replayBrowserActivityEvent).toHaveBeenCalledTimes(1);
  });

  it("refreshes the snapshot when tab events do not include a tab list", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const refreshed = snapshot({ activeTabId: "tab-2", url: "https://app.test/two", title: "Two" });
    const loadBrowserState = vi.fn(async () => refreshed);
    const applySnapshotSpy = vi.fn();

    render(<Harness applySnapshotSpy={applySnapshotSpy} capture={vi.fn()} loadBrowserState={loadBrowserState} />);

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      MockEventSource.instances[0]?.emitBrowser(browserEvent({ id: 3, type: "tab.selected", url: "https://app.test/two" }));
    });

    await waitFor(() => expect(loadBrowserState).toHaveBeenCalledWith("session-1", "invalid"));
    expect(applySnapshotSpy).toHaveBeenCalledWith(refreshed, { preserveLocalStale: false });
  });
});
