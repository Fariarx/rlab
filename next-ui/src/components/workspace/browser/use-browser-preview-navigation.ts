import { useCallback, useEffect, useRef, type FormEvent, type MutableRefObject } from "react";
import {
  browserPreviewDefaultUrl,
  normalizeBrowserPreviewUrl,
  pushFrameHistory,
  resolvePreviewFrameUrl,
  type BrowserSnapshot,
  type BrowserTab,
  type FrameHistoryState,
  type PreviewMode,
} from "../../../lib/browser-preview-model";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

interface BrowserPreviewOpenRequest {
  readonly url: string;
  readonly nonce: number;
}

interface UseBrowserPreviewNavigationInput {
  readonly applySnapshot: (next: BrowserSnapshot) => void;
  readonly clearSelection: () => void;
  readonly frameHistory: FrameHistoryState;
  readonly invalidResponseMessage: string;
  readonly liveUrl: string | null;
  readonly liveUrlRef: MutableRefObject<string | null>;
  readonly openErrorMessage: (error: string) => string;
  readonly openRequest?: BrowserPreviewOpenRequest;
  readonly postBrowserSnapshot: (path: string, body: object, invalidResponseMessage: string) => Promise<BrowserSnapshot>;
  readonly serverHostOverride: string;
  readonly sessionId: string;
  readonly setActiveTabId: StateSetter<string | null>;
  readonly setError: StateSetter<string | null>;
  readonly setFrameHistory: StateSetter<FrameHistoryState>;
  readonly setFrameKey: StateSetter<number>;
  readonly setLiveReplayBlocked: StateSetter<boolean>;
  readonly setLiveUrl: StateSetter<string | null>;
  readonly setMode: StateSetter<PreviewMode>;
  readonly setTabs: StateSetter<readonly BrowserTab[]>;
  readonly setUrl: StateSetter<string>;
  readonly syncMirror: (targetUrl: string) => Promise<void>;
  readonly url: string;
  readonly userLiveNavigationStartedRef: MutableRefObject<boolean>;
}

interface BrowserPreviewNavigationController {
  readonly adoptBrowserUrl: (nextUrl: string) => void;
  readonly navigateFrameHistory: (direction: "back" | "forward") => void;
  readonly open: (event: FormEvent<HTMLFormElement>) => void;
  readonly openTarget: (rawUrl: string) => void;
  readonly refreshLivePreview: () => void;
  readonly selectMirrorTab: (tab: BrowserTab) => Promise<void>;
}

export function useBrowserPreviewNavigation({
  applySnapshot,
  clearSelection,
  frameHistory,
  invalidResponseMessage,
  liveUrl,
  liveUrlRef,
  openErrorMessage,
  openRequest,
  postBrowserSnapshot,
  serverHostOverride,
  sessionId,
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
}: UseBrowserPreviewNavigationInput): BrowserPreviewNavigationController {
  const adoptBrowserUrl = useCallback((nextUrl: string) => {
    const normalizedUrl = resolvePreviewFrameUrl(normalizeBrowserPreviewUrl(nextUrl), serverHostOverride);
    setUrl(normalizedUrl === browserPreviewDefaultUrl ? "" : normalizedUrl);
    if (liveUrlRef.current === normalizedUrl) {
      return;
    }
    liveUrlRef.current = normalizedUrl;
    setLiveUrl(normalizedUrl);
    setFrameHistory((current) => pushFrameHistory(current, normalizedUrl));
    setFrameKey((current) => current + 1);
  }, [liveUrlRef, serverHostOverride, setFrameHistory, setFrameKey, setLiveUrl, setUrl]);

  const openTarget = useCallback((rawUrl: string) => {
    try {
      const normalizedUrl = resolvePreviewFrameUrl(normalizeBrowserPreviewUrl(rawUrl), serverHostOverride);
      userLiveNavigationStartedRef.current = true;
      liveUrlRef.current = normalizedUrl;
      setLiveUrl(normalizedUrl);
      setUrl(normalizedUrl === browserPreviewDefaultUrl ? "" : normalizedUrl);
      setFrameKey((current) => current + 1);
      setFrameHistory((current) => pushFrameHistory(current, normalizedUrl));
      setTabs([]);
      setActiveTabId(null);
      setMode("interact");
      setLiveReplayBlocked(false);
      clearSelection();
      void syncMirror(normalizedUrl);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : String(validationError);
      setError(openErrorMessage(message));
    }
  }, [
    clearSelection,
    liveUrlRef,
    openErrorMessage,
    serverHostOverride,
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
    userLiveNavigationStartedRef,
  ]);

  const open = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    openTarget(url);
  }, [openTarget, url]);

  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  const openRequestNonce = openRequest?.nonce;
  const openRequestUrl = openRequest?.url;
  useEffect(() => {
    void openRequestNonce;
    if (openRequestUrl) {
      openTargetRef.current(openRequestUrl);
    }
  }, [openRequestNonce, openRequestUrl]);

  const refreshLivePreview = useCallback(() => {
    if (!liveUrl) {
      return;
    }
    setFrameKey((current) => current + 1);
    void syncMirror(liveUrl);
  }, [liveUrl, setFrameKey, syncMirror]);

  const navigateFrameHistory = useCallback((direction: "back" | "forward") => {
    const nextIndex = direction === "back" ? frameHistory.index - 1 : frameHistory.index + 1;
    const nextUrl = frameHistory.entries[nextIndex];
    if (!nextUrl) {
      return;
    }
    setFrameHistory({ entries: frameHistory.entries, index: nextIndex });
    liveUrlRef.current = nextUrl;
    userLiveNavigationStartedRef.current = true;
    setLiveUrl(nextUrl);
    setUrl(nextUrl === browserPreviewDefaultUrl ? "" : nextUrl);
    setFrameKey((current) => current + 1);
    setError(null);
    setLiveReplayBlocked(false);
    clearSelection();
    void syncMirror(nextUrl);
  }, [clearSelection, frameHistory, liveUrlRef, setError, setFrameHistory, setFrameKey, setLiveReplayBlocked, setLiveUrl, setUrl, syncMirror, userLiveNavigationStartedRef]);

  const selectMirrorTab = useCallback(async (tab: BrowserTab) => {
    try {
      const next = await postBrowserSnapshot(
        "/api/browser/action",
        { sessionId, tabId: tab.id, type: "select-tab" },
        invalidResponseMessage,
      );
      applySnapshot(next);
      const tabUrl = resolvePreviewFrameUrl(tab.url, serverHostOverride);
      userLiveNavigationStartedRef.current = true;
      liveUrlRef.current = tabUrl;
      setLiveUrl(tabUrl);
      setUrl(tabUrl === browserPreviewDefaultUrl ? "" : tabUrl);
      setFrameHistory((current) => pushFrameHistory(current, tabUrl));
      setFrameKey((current) => current + 1);
      setLiveReplayBlocked(false);
      setError(null);
      clearSelection();
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(openErrorMessage(message));
    }
  }, [
    applySnapshot,
    clearSelection,
    invalidResponseMessage,
    liveUrlRef,
    openErrorMessage,
    postBrowserSnapshot,
    serverHostOverride,
    sessionId,
    setError,
    setFrameHistory,
    setFrameKey,
    setLiveReplayBlocked,
    setLiveUrl,
    setUrl,
    userLiveNavigationStartedRef,
  ]);

  return { adoptBrowserUrl, navigateFrameHistory, open, openTarget, refreshLivePreview, selectMirrorTab };
}
