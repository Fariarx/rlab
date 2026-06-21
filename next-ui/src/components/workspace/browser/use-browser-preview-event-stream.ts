import { useEffect, type MutableRefObject, type RefObject } from "react";
import {
  appendBrowserActivityEvent,
  browserActivityEventEffects,
  isBrowserActivityEvent,
  type BrowserActivityEvent,
  type BrowserSnapshot,
  type EventStreamStatus,
} from "../../../lib/browser-preview-model";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

interface BrowserPreviewEventStreamInput {
  readonly adoptBrowserUrl: (nextUrl: string) => void;
  readonly applySnapshot: (next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => void;
  readonly bridgeActive: boolean;
  readonly browserEventCursorRef: MutableRefObject<number>;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly invalidResponseMessage: string;
  readonly isReplayableBrowserActivityEvent: (event: BrowserActivityEvent) => boolean;
  readonly liveReplaySuppressionUntilRef: MutableRefObject<number>;
  readonly loadBrowserState: (sessionId: string, invalidResponseMessage: string) => Promise<BrowserSnapshot | null>;
  readonly localMirrorDirtyPendingRef: MutableRefObject<boolean>;
  readonly navigationUrlRef: MutableRefObject<string | null>;
  readonly replayBrowserActivityEvent: (frame: HTMLIFrameElement | null, event: BrowserActivityEvent) => boolean;
  readonly sessionId: string;
  readonly setActivityEvents: StateSetter<readonly BrowserActivityEvent[]>;
  readonly setEventStreamStatus: (status: EventStreamStatus) => void;
  readonly setLiveReplayBlocked: (blocked: boolean) => void;
  readonly setSnapshot: StateSetter<BrowserSnapshot | null>;
}

export function useBrowserPreviewEventStream({
  adoptBrowserUrl,
  applySnapshot,
  bridgeActive,
  browserEventCursorRef,
  frameRef,
  invalidResponseMessage,
  isReplayableBrowserActivityEvent,
  liveReplaySuppressionUntilRef,
  loadBrowserState,
  localMirrorDirtyPendingRef,
  navigationUrlRef,
  replayBrowserActivityEvent,
  sessionId,
  setActivityEvents,
  setEventStreamStatus,
  setLiveReplayBlocked,
  setSnapshot,
}: BrowserPreviewEventStreamInput): void {
  useEffect(() => {
    if (!bridgeActive || typeof EventSource === "undefined") {
      setEventStreamStatus("idle");
      return;
    }
    let alive = true;
    const source = new EventSource(`/api/browser/events?sessionId=${encodeURIComponent(sessionId)}`);
    setEventStreamStatus("connected");
    const handleBrowserEvent = (event: Event) => {
      if (!alive) {
        return;
      }
      const message = event as MessageEvent<string>;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data) as unknown;
      } catch {
        return;
      }
      if (!isBrowserActivityEvent(parsed) || parsed.sessionId !== sessionId) {
        return;
      }
      const staleEvent = parsed.id <= browserEventCursorRef.current;
      browserEventCursorRef.current = Math.max(browserEventCursorRef.current, parsed.id);
      setActivityEvents((current) => appendBrowserActivityEvent(current, parsed));
      if (staleEvent) {
        return;
      }
      if (isReplayableBrowserActivityEvent(parsed)) {
        let replayed = false;
        liveReplaySuppressionUntilRef.current = Date.now() + 500;
        try {
          replayed = replayBrowserActivityEvent(frameRef.current, parsed);
        } catch {
          replayed = false;
        }
        setLiveReplayBlocked(!replayed);
      }
      const eventEffects = browserActivityEventEffects(parsed);
      if (eventEffects.navigationUrl) {
        navigationUrlRef.current = eventEffects.navigationUrl;
        if (eventEffects.resetReplayBlocked) {
          setLiveReplayBlocked(false);
        }
        adoptBrowserUrl(eventEffects.navigationUrl);
      }
      if (eventEffects.snapshotPatch) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                ...eventEffects.snapshotPatch,
              }
            : current,
        );
      }
      if (eventEffects.refreshTabs) {
        void loadBrowserState(sessionId, invalidResponseMessage)
          .then((next) => {
            if (alive && next) {
              applySnapshot(next, { preserveLocalStale: localMirrorDirtyPendingRef.current });
            }
          })
          .catch(() => undefined);
      }
    };
    source.addEventListener("browser", handleBrowserEvent);
    source.onerror = () => {
      if (alive) {
        setEventStreamStatus("error");
      }
    };
    return () => {
      alive = false;
      source.removeEventListener("browser", handleBrowserEvent);
      source.close();
    };
  }, [
    adoptBrowserUrl,
    applySnapshot,
    bridgeActive,
    browserEventCursorRef,
    frameRef,
    invalidResponseMessage,
    isReplayableBrowserActivityEvent,
    liveReplaySuppressionUntilRef,
    loadBrowserState,
    localMirrorDirtyPendingRef,
    navigationUrlRef,
    replayBrowserActivityEvent,
    sessionId,
    setActivityEvents,
    setEventStreamStatus,
    setLiveReplayBlocked,
    setSnapshot,
  ]);
}
