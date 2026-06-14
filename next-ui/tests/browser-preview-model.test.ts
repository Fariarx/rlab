import { describe, expect, it } from "vitest";
import type { BrowserActivityEvent, BrowserComponentSelection, BrowserSnapshot, BrowserTab, MirrorStatus } from "../src/lib/browser-preview-model";
import {
  appendBrowserActivityEvent,
  browserActivityEventEffects,
  browserPreviewSnapshotApplication,
  browserPreviewStatusLabelKeys,
  browserTabHost,
  browserTabLabel,
  createBrowserPreviewAnnotationState,
  mirrorStatusDotPulse,
  mirrorStatusDotStatus,
} from "../src/lib/browser-preview-model";

function tab(patch: Partial<BrowserTab>): BrowserTab {
  return {
    id: patch.id ?? "tab-1",
    url: patch.url ?? "about:blank",
    title: patch.title ?? "",
    active: patch.active ?? true,
  };
}

function event(id: number): BrowserActivityEvent {
  return {
    id,
    sessionId: "session",
    tabId: "tab-1",
    type: "action.click",
    label: `Click ${id}`,
    at: `2026-06-14T00:00:${String(id).padStart(2, "0")}.000Z`,
  };
}

function snapshot(patch: Partial<BrowserSnapshot> = {}): BrowserSnapshot {
  return {
    sessionId: patch.sessionId ?? "session",
    activeTabId: patch.activeTabId ?? "tab-1",
    tabs: patch.tabs ?? [tab({ id: patch.activeTabId ?? "tab-1", url: patch.url ?? "about:blank", title: patch.title ?? "" })],
    freshness: patch.freshness ?? "synced",
    url: patch.url ?? "about:blank",
    title: patch.title ?? "",
    viewport: patch.viewport ?? { width: 800, height: 600 },
    updatedAt: patch.updatedAt ?? "2026-06-14T00:00:00.000Z",
    ...(patch.latestEvent ? { latestEvent: patch.latestEvent } : {}),
  };
}

describe("browser-preview-model", () => {
  it("deduplicates, sorts, and caps browser activity events", () => {
    const events = [1, 3, 2, 4, 5, 6, 7, 8].map(event);
    const next = appendBrowserActivityEvent(events, { ...event(3), label: "Click updated" });

    expect(next.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(next.find((item) => item.id === 3)?.label).toBe("Click updated");

    const capped = appendBrowserActivityEvent(next, event(9));
    expect(capped.map((item) => item.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("describes browser activity event effects for preview orchestration", () => {
    expect(browserActivityEventEffects({ ...event(1), type: "navigation.done", url: "https://app.test/page", title: "App" })).toEqual({
      navigationUrl: "https://app.test/page",
      resetReplayBlocked: true,
      refreshTabs: false,
      snapshotPatch: { url: "https://app.test/page", title: "App" },
    });

    expect(browserActivityEventEffects({ ...event(2), type: "tab.selected", url: "https://app.test/tab" })).toEqual({
      navigationUrl: "https://app.test/tab",
      resetReplayBlocked: true,
      refreshTabs: true,
      snapshotPatch: { url: "https://app.test/tab" },
    });

    expect(browserActivityEventEffects({ ...event(3), type: "tab.closed" })).toEqual({
      navigationUrl: null,
      resetReplayBlocked: false,
      refreshTabs: true,
      snapshotPatch: null,
    });

    expect(browserActivityEventEffects({ ...event(4), type: "action.click", title: "Clicked" })).toEqual({
      navigationUrl: null,
      resetReplayBlocked: false,
      refreshTabs: false,
      snapshotPatch: { title: "Clicked" },
    });
  });

  it("projects browser snapshots into preview state", () => {
    const latestEvent = event(9);
    const next = snapshot({ activeTabId: "tab-2", freshness: "dirty", latestEvent, title: "Dashboard", url: "https://app.test" });

    expect(browserPreviewSnapshotApplication("idle", next)).toEqual({
      activeTabId: "tab-2",
      latestEvent,
      mirrorStatus: "dirty",
      snapshot: next,
      tabs: next.tabs,
    });
  });

  it("preserves local stale mirror status when a synced snapshot arrives", () => {
    const next = snapshot({ freshness: "synced" });

    expect(browserPreviewSnapshotApplication("dirty", next, { preserveLocalStale: true }).mirrorStatus).toBe("dirty");
    expect(browserPreviewSnapshotApplication("blocked", next, { preserveLocalStale: true }).mirrorStatus).toBe("blocked");
    expect(browserPreviewSnapshotApplication("error", next, { preserveLocalStale: true }).mirrorStatus).toBe("synced");
    expect(browserPreviewSnapshotApplication("dirty", snapshot({ freshness: "error" }), { preserveLocalStale: true }).mirrorStatus).toBe("error");
  });

  it("builds tab labels and favicon hosts from browser tabs", () => {
    expect(browserTabLabel(tab({ title: "  Dashboard  ", url: "https://example.test/app" }))).toBe("Dashboard");
    expect(browserTabLabel(tab({ url: "https://example.test/app" }))).toBe("example.test");
    expect(browserTabLabel(tab({ url: "about:blank" }))).toBe("about:blank");
    expect(browserTabLabel(tab({ url: "not a url" }))).toBe("not a url");

    expect(browserTabHost("https://example.test/app")).toBe("example.test");
    expect(browserTabHost("about:blank")).toBe("");
    expect(browserTabHost("not a url")).toBe("");
  });

  it("maps mirror freshness to status-dot tone and pulse", () => {
    const cases: ReadonlyArray<readonly [MirrorStatus, ReturnType<typeof mirrorStatusDotStatus>, boolean]> = [
      ["syncing", "running", true],
      ["synced", "ok", false],
      ["dirty", "warn", true],
      ["blocked", "warn", true],
      ["error", "error", true],
      ["idle", "idle", false],
    ];

    for (const [status, tone, pulse] of cases) {
      expect(mirrorStatusDotStatus(status)).toBe(tone);
      expect(mirrorStatusDotPulse(status)).toBe(pulse);
    }
  });

  it("chooses distinct labels for cross-origin mirror blocks", () => {
    expect(browserPreviewStatusLabelKeys("blocked", "cross-origin frame")).toEqual({
      mirrorStatusKey: "browserPreviewMirrorCrossOrigin",
      playwrightStatusKey: "browserPreviewPlaywrightStatusCrossOrigin",
      crossOriginBlocked: true,
    });
    expect(browserPreviewStatusLabelKeys("blocked", "storage blocked")).toEqual({
      mirrorStatusKey: "browserPreviewMirrorBlocked",
      playwrightStatusKey: "browserPreviewPlaywrightStatusBlocked",
      crossOriginBlocked: false,
    });
  });

  it("builds annotation state for selected regions", () => {
    const state = createBrowserPreviewAnnotationState({
      liveUrl: "https://example.test",
      selection: { x: 10, y: 20, width: 80, height: 40 },
      dragStart: null,
      componentSelection: null,
      viewport: { width: 1280, height: 720 },
      comment: "Fix spacing",
      canSend: true,
      regionLabel: "Region",
      regionDescription: "x=10 y=20",
    });

    expect(state.selectionReady).toBe(true);
    expect(state.committedSelectionReady).toBe(true);
    expect(state.canSendAnnotation).toBe(true);
    expect(state.panel).toEqual({
      kind: "region",
      label: "Region",
      description: "x=10 y=20",
      rect: { x: 10, y: 20, width: 80, height: 40 },
      viewport: { width: 1280, height: 720 },
    });
  });

  it("builds annotation state for selected components", () => {
    const component: BrowserComponentSelection = {
      label: "Button",
      selector: "button.primary",
      tagName: "button",
      classes: ["primary"],
      text: "",
      rect: { x: 1, y: 2, width: 30, height: 20 },
      viewport: { width: 400, height: 300 },
    };

    const state = createBrowserPreviewAnnotationState({
      liveUrl: "https://example.test",
      selection: null,
      dragStart: null,
      componentSelection: component,
      viewport: undefined,
      comment: "Rename",
      canSend: true,
      regionLabel: "Region",
      regionDescription: "unused",
    });

    expect(state.componentReady).toBe(true);
    expect(state.canSendComponent).toBe(true);
    expect(state.panel).toMatchObject({ kind: "component", label: "Button", description: "button.primary" });
  });
});
