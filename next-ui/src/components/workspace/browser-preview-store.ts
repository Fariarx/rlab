import { action, makeObservable, observable } from "mobx";
import {
  type BrowserActivityEvent,
  type BrowserComponentSelection,
  type BrowserPoint,
  type BrowserSelectionRect,
  type BrowserSnapshot,
  type BrowserTab,
  type BrowserViewport,
  type EventStreamStatus,
  type FrameHistoryState,
  type MirrorStatus,
  type PreviewMode,
} from "./browser-preview-model";

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class PreviewTabFaviconStore {
  failed = false;

  constructor() {
    makeObservable(this, {
      failed: observable,
      setFailed: action.bound,
    });
  }

  setFailed(value: StateUpdater<boolean>): void {
    this.failed = resolveState(this.failed, value);
  }
}

export class BrowserPreviewStore {
  url = "";

  liveUrl: string | null = null;

  frameKey = 0;

  mode: PreviewMode = "interact";

  snapshot: BrowserSnapshot | null = null;

  tabs: readonly BrowserTab[] = [];

  activeTabId: string | null = null;

  activityEvents: readonly BrowserActivityEvent[] = [];

  eventStreamStatus: EventStreamStatus = "idle";

  error: string | null = null;

  liveReplayBlocked = false;

  mirrorStatus: MirrorStatus = "idle";

  frameHistory: FrameHistoryState = { entries: [], index: -1 };

  dragStart: BrowserPoint | null = null;

  selection: BrowserSelectionRect | null = null;

  componentSelection: BrowserComponentSelection | null = null;

  selectionViewport: BrowserViewport | null = null;

  comment = "";

  browserInstalled: boolean | null = null;

  installingBrowser = false;

  installBrowserError: string | null = null;

  constructor() {
    makeObservable(this, {
      url: observable,
      liveUrl: observable,
      frameKey: observable,
      mode: observable,
      snapshot: observable.ref,
      tabs: observable.ref,
      activeTabId: observable,
      activityEvents: observable.ref,
      eventStreamStatus: observable,
      error: observable,
      liveReplayBlocked: observable,
      mirrorStatus: observable,
      frameHistory: observable.ref,
      dragStart: observable.ref,
      selection: observable.ref,
      componentSelection: observable.ref,
      selectionViewport: observable.ref,
      comment: observable,
      browserInstalled: observable,
      installingBrowser: observable,
      installBrowserError: observable,
      setUrl: action.bound,
      setLiveUrl: action.bound,
      setFrameKey: action.bound,
      setMode: action.bound,
      setSnapshot: action.bound,
      setTabs: action.bound,
      setActiveTabId: action.bound,
      setActivityEvents: action.bound,
      setEventStreamStatus: action.bound,
      setError: action.bound,
      setLiveReplayBlocked: action.bound,
      setMirrorStatus: action.bound,
      setFrameHistory: action.bound,
      setDragStart: action.bound,
      setSelection: action.bound,
      setComponentSelection: action.bound,
      setSelectionViewport: action.bound,
      setComment: action.bound,
      setBrowserInstalled: action.bound,
      setInstallingBrowser: action.bound,
      setInstallBrowserError: action.bound,
    });
  }

  setUrl(value: StateUpdater<string>): void {
    this.url = resolveState(this.url, value);
  }

  setLiveUrl(value: StateUpdater<string | null>): void {
    this.liveUrl = resolveState(this.liveUrl, value);
  }

  setFrameKey(value: StateUpdater<number>): void {
    this.frameKey = resolveState(this.frameKey, value);
  }

  setMode(value: StateUpdater<PreviewMode>): void {
    this.mode = resolveState(this.mode, value);
  }

  setSnapshot(value: StateUpdater<BrowserSnapshot | null>): void {
    this.snapshot = resolveState(this.snapshot, value);
  }

  setTabs(value: StateUpdater<readonly BrowserTab[]>): void {
    this.tabs = resolveState(this.tabs, value);
  }

  setActiveTabId(value: StateUpdater<string | null>): void {
    this.activeTabId = resolveState(this.activeTabId, value);
  }

  setActivityEvents(value: StateUpdater<readonly BrowserActivityEvent[]>): void {
    this.activityEvents = resolveState(this.activityEvents, value);
  }

  setEventStreamStatus(value: StateUpdater<EventStreamStatus>): void {
    this.eventStreamStatus = resolveState(this.eventStreamStatus, value);
  }

  setError(value: StateUpdater<string | null>): void {
    this.error = resolveState(this.error, value);
  }

  setLiveReplayBlocked(value: StateUpdater<boolean>): void {
    this.liveReplayBlocked = resolveState(this.liveReplayBlocked, value);
  }

  setMirrorStatus(value: StateUpdater<MirrorStatus>): void {
    this.mirrorStatus = resolveState(this.mirrorStatus, value);
  }

  setFrameHistory(value: StateUpdater<FrameHistoryState>): void {
    this.frameHistory = resolveState(this.frameHistory, value);
  }

  setDragStart(value: StateUpdater<BrowserPoint | null>): void {
    this.dragStart = resolveState(this.dragStart, value);
  }

  setSelection(value: StateUpdater<BrowserSelectionRect | null>): void {
    this.selection = resolveState(this.selection, value);
  }

  setComponentSelection(value: StateUpdater<BrowserComponentSelection | null>): void {
    this.componentSelection = resolveState(this.componentSelection, value);
  }

  setSelectionViewport(value: StateUpdater<BrowserViewport | null>): void {
    this.selectionViewport = resolveState(this.selectionViewport, value);
  }

  setComment(value: StateUpdater<string>): void {
    this.comment = resolveState(this.comment, value);
  }

  setBrowserInstalled(value: StateUpdater<boolean | null>): void {
    this.browserInstalled = resolveState(this.browserInstalled, value);
  }

  setInstallingBrowser(value: StateUpdater<boolean>): void {
    this.installingBrowser = resolveState(this.installingBrowser, value);
  }

  setInstallBrowserError(value: StateUpdater<string | null>): void {
    this.installBrowserError = resolveState(this.installBrowserError, value);
  }
}
