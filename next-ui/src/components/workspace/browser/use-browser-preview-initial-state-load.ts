import { type RefObject, useEffect, useRef } from "react";
import type { BrowserSnapshot, MirrorStatus } from "../../../lib/browser-preview-model";

export interface UseBrowserPreviewInitialStateLoadInput {
  readonly adoptBrowserUrl: (nextUrl: string) => void;
  readonly agentNavigationUrlRef: RefObject<string | null>;
  readonly applySnapshot: (next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => void;
  readonly bridgeActive: boolean;
  readonly browserEventCursorRef: RefObject<number>;
  readonly invalidResponseMessage: string;
  readonly loadBrowserState: (sessionId: string, invalidResponseMessage: string) => Promise<BrowserSnapshot | null>;
  readonly localMirrorDirtyPendingRef: RefObject<boolean>;
  readonly openErrorMessage: (message: string) => string;
  readonly sessionId: string;
  readonly setError: (message: string | null) => void;
  readonly setMirrorStatus: (status: MirrorStatus) => void;
  readonly userLiveNavigationStartedRef: RefObject<boolean>;
}

export function useBrowserPreviewInitialStateLoad({
  adoptBrowserUrl,
  agentNavigationUrlRef,
  applySnapshot,
  bridgeActive,
  browserEventCursorRef,
  invalidResponseMessage,
  loadBrowserState,
  localMirrorDirtyPendingRef,
  openErrorMessage,
  sessionId,
  setError,
  setMirrorStatus,
  userLiveNavigationStartedRef,
}: UseBrowserPreviewInitialStateLoadInput): void {
  const handlersRef = useRef({
    adoptBrowserUrl,
    applySnapshot,
    getAgentNavigationUrl: () => agentNavigationUrlRef.current,
    getBrowserEventCursor: () => browserEventCursorRef.current ?? 0,
    getLocalMirrorDirtyPending: () => localMirrorDirtyPendingRef.current === true,
    getUserLiveNavigationStarted: () => userLiveNavigationStartedRef.current === true,
    openErrorMessage,
    setError,
    setMirrorStatus,
  });
  handlersRef.current = {
    adoptBrowserUrl,
    applySnapshot,
    getAgentNavigationUrl: () => agentNavigationUrlRef.current,
    getBrowserEventCursor: () => browserEventCursorRef.current ?? 0,
    getLocalMirrorDirtyPending: () => localMirrorDirtyPendingRef.current === true,
    getUserLiveNavigationStarted: () => userLiveNavigationStartedRef.current === true,
    openErrorMessage,
    setError,
    setMirrorStatus,
  };

  useEffect(() => {
    if (!bridgeActive) {
      return;
    }
    let canceled = false;
    const eventCursorAtRequest = handlersRef.current.getBrowserEventCursor();
    void loadBrowserState(sessionId, invalidResponseMessage)
      .then((next) => {
        if (canceled || next === null) {
          return;
        }
        const handlers = handlersRef.current;
        handlers.applySnapshot(next, { preserveLocalStale: handlers.getLocalMirrorDirtyPending() });
        const agentNavigationUrl = handlers.getAgentNavigationUrl();
        if (agentNavigationUrl) {
          handlers.adoptBrowserUrl(agentNavigationUrl);
        } else if (!handlers.getUserLiveNavigationStarted() && handlers.getBrowserEventCursor() === eventCursorAtRequest) {
          handlers.adoptBrowserUrl(next.url);
        }
        handlers.setError(null);
      })
      .catch((operationError: unknown) => {
        if (canceled) {
          return;
        }
        const handlers = handlersRef.current;
        const message = operationError instanceof Error ? operationError.message : String(operationError);
        handlers.setMirrorStatus("error");
        handlers.setError(handlers.openErrorMessage(message));
      });
    return () => {
      canceled = true;
    };
  }, [
    bridgeActive,
    invalidResponseMessage,
    loadBrowserState,
    sessionId,
  ]);
}
