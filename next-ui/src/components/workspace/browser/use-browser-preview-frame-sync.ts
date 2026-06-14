import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import {
  browserPreviewDefaultUrl,
  browserSyncRequest,
  pushFrameHistory,
  readableFrameUrl,
  resolvePreviewMirrorUrl,
  type BrowserSnapshot,
  type FrameHistoryState,
  type MirrorStatus,
} from "../../../lib/browser-preview-model";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

interface UseBrowserPreviewFrameSyncInput {
  readonly active: boolean;
  readonly applySnapshot: (next: BrowserSnapshot) => void;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly invalidResponseMessage: string;
  readonly liveUrl: string | null;
  readonly liveUrlRef: MutableRefObject<string | null>;
  readonly localMirrorDirtyPendingRef: MutableRefObject<boolean>;
  readonly mirrorStatus: MirrorStatus;
  readonly openErrorMessage: (error: string) => string;
  readonly postBrowserSnapshot: (path: string, body: object, invalidResponseMessage: string) => Promise<BrowserSnapshot>;
  readonly sessionId: string;
  readonly setError: (message: string | null) => void;
  readonly setFrameHistory: StateSetter<FrameHistoryState>;
  readonly setLiveReplayBlocked: (blocked: boolean) => void;
  readonly setLiveUrl: (url: string) => void;
  readonly setMirrorStatus: (status: MirrorStatus) => void;
  readonly setUrl: (url: string) => void;
  readonly suppressFrameDirtyUntilRef: MutableRefObject<number>;
}

interface BrowserPreviewFrameSyncController {
  readonly handleFrameLoad: () => void;
  readonly markMirrorDirty: (reason: string, dirtyUrl?: string) => Promise<void>;
  readonly syncMirror: (targetUrl: string) => Promise<void>;
}

export function useBrowserPreviewFrameSync({
  active,
  applySnapshot,
  frameRef,
  invalidResponseMessage,
  liveUrl,
  liveUrlRef,
  localMirrorDirtyPendingRef,
  mirrorStatus,
  openErrorMessage,
  postBrowserSnapshot,
  sessionId,
  setError,
  setFrameHistory,
  setLiveReplayBlocked,
  setLiveUrl,
  setMirrorStatus,
  setUrl,
  suppressFrameDirtyUntilRef,
}: UseBrowserPreviewFrameSyncInput): BrowserPreviewFrameSyncController {
  const frameListenerCleanupRef = useRef<(() => void) | null>(null);

  const markMirrorDirty = useCallback(async (reason: string, dirtyUrl?: string) => {
    const blocked = reason.toLowerCase().includes("cross-origin") || reason.toLowerCase().includes("storage blocked");
    localMirrorDirtyPendingRef.current = true;
    setMirrorStatus(blocked ? "blocked" : "dirty");
    try {
      const body = dirtyUrl ? { sessionId, reason, url: dirtyUrl } : { sessionId, reason };
      const next = await postBrowserSnapshot("/api/browser/dirty", body, invalidResponseMessage);
      applySnapshot(next);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(openErrorMessage(message));
    } finally {
      localMirrorDirtyPendingRef.current = false;
    }
  }, [applySnapshot, invalidResponseMessage, localMirrorDirtyPendingRef, openErrorMessage, postBrowserSnapshot, sessionId, setError, setMirrorStatus]);

  const syncMirror = useCallback(async (targetUrl: string) => {
    setMirrorStatus("syncing");
    setError(null);
    try {
      const syncRequest = browserSyncRequest(frameRef.current, sessionId, targetUrl);
      const mirrorBody = { ...syncRequest.request, url: resolvePreviewMirrorUrl(syncRequest.request.url) };
      const next = await postBrowserSnapshot("/api/browser/sync", mirrorBody, invalidResponseMessage);
      applySnapshot(next);
      setLiveReplayBlocked(false);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(openErrorMessage(message));
    }
  }, [applySnapshot, frameRef, invalidResponseMessage, openErrorMessage, postBrowserSnapshot, sessionId, setError, setLiveReplayBlocked, setMirrorStatus]);

  const syncMirrorRef = useRef(syncMirror);
  syncMirrorRef.current = syncMirror;
  useEffect(() => {
    if (!active || mirrorStatus !== "dirty" || !liveUrl) {
      return;
    }
    const handle = window.setTimeout(() => {
      void syncMirrorRef.current(liveUrl);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [active, mirrorStatus, liveUrl]);

  const detachFrameListeners = useCallback(() => {
    frameListenerCleanupRef.current?.();
    frameListenerCleanupRef.current = null;
  }, []);

  const markDirtyFromFrame = useCallback((reason: string) => {
    if (Date.now() < suppressFrameDirtyUntilRef.current) {
      return;
    }
    const currentUrl = readableFrameUrl(frameRef.current) ?? liveUrlRef.current ?? undefined;
    void markMirrorDirty(reason, currentUrl);
  }, [frameRef, liveUrlRef, markMirrorDirty, suppressFrameDirtyUntilRef]);

  const attachFrameDirtyListeners = useCallback((frame: HTMLIFrameElement) => {
    detachFrameListeners();
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      return;
    }
    try {
      const frameDocument = frameWindow.document;
      const dirtyEvents: ReadonlyArray<readonly [Document | Window, keyof DocumentEventMap | keyof WindowEventMap, string]> = [
        [frameDocument, "click", "iframe click"],
        [frameDocument, "input", "iframe input"],
        [frameDocument, "submit", "iframe submit"],
        [frameWindow, "scroll", "iframe scroll"],
        [frameWindow, "popstate", "iframe history"],
        [frameWindow, "hashchange", "iframe hashchange"],
      ];
      const cleanups = dirtyEvents.map(([target, eventName, reason]) => {
        const listener = () => markDirtyFromFrame(reason);
        target.addEventListener(eventName, listener, true);
        return () => target.removeEventListener(eventName, listener, true);
      });
      frameListenerCleanupRef.current = () => {
        for (const cleanup of cleanups) {
          cleanup();
        }
      };
    } catch {
      detachFrameListeners();
    }
  }, [detachFrameListeners, markDirtyFromFrame]);

  const handleFrameLoad = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const currentUrl = readableFrameUrl(frame);
    if (!currentUrl) {
      detachFrameListeners();
      return;
    }
    attachFrameDirtyListeners(frame);
    if (currentUrl !== browserPreviewDefaultUrl && liveUrlRef.current && liveUrlRef.current !== currentUrl) {
      liveUrlRef.current = currentUrl;
      setLiveUrl(currentUrl);
      setUrl(currentUrl === browserPreviewDefaultUrl ? "" : currentUrl);
      setFrameHistory((current) => pushFrameHistory(current, currentUrl));
      void markMirrorDirty("iframe navigation", currentUrl);
    }
  }, [attachFrameDirtyListeners, detachFrameListeners, frameRef, liveUrlRef, markMirrorDirty, setFrameHistory, setLiveUrl, setUrl]);

  useEffect(() => {
    return () => {
      detachFrameListeners();
    };
  }, [detachFrameListeners]);

  return { handleFrameLoad, markMirrorDirty, syncMirror };
}
