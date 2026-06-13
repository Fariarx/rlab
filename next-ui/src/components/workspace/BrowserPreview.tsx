import AdsClickIcon from "@mui/icons-material/AdsClick";
import LanguageIcon from "@mui/icons-material/Language";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import { Alert, Box, Button, CircularProgress, IconButton, InputBase, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  browserPreviewDefaultUrl,
  browserSyncRequest,
  isBrowserActivityEvent,
  isRecord,
  loadBrowserState,
  normalizeBrowserPreviewUrl,
  payloadError,
  postBrowserSnapshot,
  pushFrameHistory,
  readableFrameUrl,
  resolvePreviewFrameUrl,
  resolvePreviewMirrorUrl,
  viewportFromElement,
  type BrowserActivityEvent,
  type BrowserComponentSelection,
  type BrowserPoint,
  type BrowserPreviewProps,
  type BrowserSelectionPanel,
  type BrowserSelectionRect,
  type BrowserSnapshot,
  type BrowserTab,
  type BrowserViewport,
  type EventStreamStatus,
  type FrameHistoryState,
  type MirrorStatus,
  type PreviewMode,
} from "./browser-preview-model";
import { isReplayableBrowserActivityEvent, replayBrowserActivityEvent } from "./browser-preview-live-replay";
import { BrowserPreviewStore, PreviewTabFaviconStore } from "./browser-preview-store";
import {
  annotationPanelHeightCss,
  annotationPanelSx,
  annotationPanelWidthCss,
  buildAnnotationMessage,
  buildComponentAnnotationMessage,
  cropComponentScreenshot,
  pickBrowserComponent,
  pointFromPointerEvent,
  rectSx,
  selectionRectBetween,
} from "./browser-preview-selection";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, StatusDot, useToast } from "../ui";

const tooltippedControlSx = { display: "inline-flex", flex: "0 0 auto" } as const;

export type { BrowserActivityEvent } from "./browser-preview-model";

const visuallyHiddenSx = {
  position: "absolute",
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function controlTooltip(title: string, child: ReactElement) {
  return (
    <Tooltip title={title} enterDelay={0} arrow>
      <Box component="span" sx={tooltippedControlSx}>
        {child}
      </Box>
    </Tooltip>
  );
}

function appendBrowserActivityEvent(events: readonly BrowserActivityEvent[], event: BrowserActivityEvent): readonly BrowserActivityEvent[] {
  const withoutDuplicate = events.filter((item) => item.id !== event.id);
  return [...withoutDuplicate, event].sort((a, b) => a.id - b.id).slice(-8);
}

function browserTabLabel(tab: BrowserTab): string {
  if (tab.title.trim()) {
    return tab.title.trim();
  }
  if (tab.url === "about:blank") {
    return "about:blank";
  }
  try {
    return new URL(tab.url).host;
  } catch {
    return tab.url;
  }
}

function tabHost(url: string): string {
  if (!url || url === "about:blank") {
    return "";
  }
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function mirrorStatusDotStatus(status: MirrorStatus): "running" | "ok" | "warn" | "error" | "idle" {
  if (status === "syncing") {
    return "running";
  }
  if (status === "synced") {
    return "ok";
  }
  if (status === "dirty" || status === "blocked") {
    return "warn";
  }
  if (status === "error") {
    return "error";
  }
  return "idle";
}

function mirrorStatusDotPulse(status: MirrorStatus): boolean {
  return status === "syncing" || status === "dirty" || status === "blocked" || status === "error";
}

/** A tab favicon with a graceful globe fallback (offline / blocked / blank). */
const PreviewTabFavicon = observer(function PreviewTabFavicon({ url }: { readonly url: string }) {
  const [store] = useState(() => new PreviewTabFaviconStore());
  const { failed, setFailed } = store;
  const host = tabHost(url);
  if (!host || failed) {
    return <LanguageIcon sx={{ fontSize: 13, color: "text.tertiary", flex: "0 0 auto" }} />;
  }
  return (
    <Box
      component="img"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={13}
      height={13}
      onError={() => setFailed(true)}
      sx={{ flex: "0 0 auto", borderRadius: "2px", display: "block" }}
    />
  );
});

export const BrowserPreview = observer(function BrowserPreview({
  sessionId,
  active,
  bridgeActive = active,
  onSendAnnotation,
  onActivityEventsChange,
  bottomInset = 0,
  openRequest,
  serverHostOverride = "",
}: BrowserPreviewProps) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const { toast } = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameListenerCleanupRef = useRef<(() => void) | null>(null);
  const suppressFrameDirtyUntilRef = useRef(0);
  const [store] = useState(() => new BrowserPreviewStore());
  const {
    url,
    setUrl,
    liveUrl,
    setLiveUrl,
    frameKey,
    setFrameKey,
    mode,
    setMode,
    snapshot,
    setSnapshot,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activityEvents,
    setActivityEvents,
    eventStreamStatus,
    setEventStreamStatus,
    error,
    setError,
    liveReplayBlocked,
    setLiveReplayBlocked,
    mirrorStatus,
    setMirrorStatus,
    frameHistory,
    setFrameHistory,
    dragStart,
    setDragStart,
    selection,
    setSelection,
    componentSelection,
    setComponentSelection,
    selectionViewport,
    setSelectionViewport,
    comment,
    setComment,
    browserInstalled,
    setBrowserInstalled,
    installingBrowser,
    setInstallingBrowser,
    installBrowserError,
    setInstallBrowserError,
  } = store;
  const liveUrlRef = useRef<string | null>(null);
  const userLiveNavigationStartedRef = useRef(false);
  const browserEventCursorRef = useRef(0);
  const agentNavigationUrlRef = useRef<string | null>(null);
  const localMirrorDirtyPendingRef = useRef(false);
  const viewport = selectionViewport ?? snapshot?.viewport;
  const selectionReady = liveUrl !== null && selection !== null && selection.width >= 4 && selection.height >= 4;
  const committedSelectionReady = selectionReady && dragStart === null;
  const componentReady = liveUrl !== null && componentSelection !== null;
  const canSendAnnotation = committedSelectionReady && comment.trim().length > 0 && onSendAnnotation !== undefined;
  const canSendComponent = componentReady && comment.trim().length > 0 && onSendAnnotation !== undefined;
  const panelState: BrowserSelectionPanel | null =
    componentSelection !== null
      ? {
          kind: "component",
          label: componentSelection.label,
          description: componentSelection.text || componentSelection.selector,
          rect: componentSelection.rect,
          viewport: componentSelection.viewport,
        }
      : committedSelectionReady && selection !== null && viewport !== undefined
        ? {
            kind: "region",
            label: t("browserPreviewRegionLabel"),
            description: t("browserPreviewRegionDescription", { x: selection.x, y: selection.y, width: selection.width, height: selection.height }),
            rect: selection,
            viewport,
          }
        : null;
  const panelPosition = panelState !== null ? annotationPanelSx(panelState.rect, panelState.viewport) : null;
  const title = useMemo(() => snapshot?.title || liveUrl || t("browserPreviewTitle"), [liveUrl, snapshot, t]);
  const mirrorSyncing = mirrorStatus === "syncing";
  const canGoBack = frameHistory.index > 0;
  const canGoForward = frameHistory.index >= 0 && frameHistory.index < frameHistory.entries.length - 1;
  const latestPointEvent = [...activityEvents].reverse().find((event) => event.type === "action.click" && event.point);
  const crossOriginBlocked = mirrorStatus === "blocked" && snapshot?.freshnessReason?.toLowerCase().includes("cross-origin");
  const mirrorStatusText =
    mirrorStatus === "syncing"
      ? t("browserPreviewMirrorSyncing")
      : mirrorStatus === "synced"
        ? t("browserPreviewMirrorSynced")
        : mirrorStatus === "dirty"
          ? t("browserPreviewMirrorDirty")
          : crossOriginBlocked
            ? t("browserPreviewMirrorCrossOrigin")
            : mirrorStatus === "blocked"
              ? t("browserPreviewMirrorBlocked")
              : mirrorStatus === "error"
                ? t("browserPreviewMirrorError")
                : t("browserPreviewLiveOnly");
  const playwrightStatusLabel =
    mirrorStatus === "syncing"
      ? t("browserPreviewPlaywrightStatusSyncing")
      : mirrorStatus === "synced"
        ? t("browserPreviewPlaywrightStatusSynced")
        : mirrorStatus === "dirty"
          ? t("browserPreviewPlaywrightStatusDirty")
          : crossOriginBlocked
            ? t("browserPreviewPlaywrightStatusCrossOrigin")
            : mirrorStatus === "blocked"
              ? t("browserPreviewPlaywrightStatusBlocked")
              : mirrorStatus === "error"
                ? t("browserPreviewPlaywrightStatusError")
                : t("browserPreviewPlaywrightStatusIdle");

  const adoptBrowserUrl = (nextUrl: string) => {
    const normalizedUrl = resolvePreviewFrameUrl(normalizeBrowserPreviewUrl(nextUrl), serverHostOverride);
    setUrl(normalizedUrl === browserPreviewDefaultUrl ? "" : normalizedUrl);
    if (liveUrlRef.current === normalizedUrl) {
      return;
    }
    liveUrlRef.current = normalizedUrl;
    setLiveUrl(normalizedUrl);
    setFrameHistory((current) => pushFrameHistory(current, normalizedUrl));
    setFrameKey((current) => current + 1);
  };

  useEffect(() => {
    liveUrlRef.current = liveUrl;
  }, [liveUrl]);

  useEffect(() => {
    browserEventCursorRef.current = 0;
    agentNavigationUrlRef.current = null;
    setActivityEvents([]);
  }, [sessionId]);

  useEffect(() => {
    onActivityEventsChange?.(activityEvents);
  }, [activityEvents, onActivityEventsChange]);

  useEffect(() => {
    if (!active || browserInstalled !== null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/health");
        const payload = (await response.json()) as unknown;
        // Only flip to a definitive state when /api/health reports a real boolean;
        // an unrecognized shape leaves the tab in its normal (optimistic) mode.
        const installed = isRecord(payload) && isRecord(payload.browser) && typeof payload.browser.installed === "boolean" ? payload.browser.installed : null;
        if (!cancelled && installed !== null) {
          setBrowserInstalled(installed);
        }
      } catch {
        // Leave the tab usable; a real navigation will surface any backend error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, browserInstalled]);

  const applySnapshot = (next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => {
    setSnapshot(next);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setMirrorStatus((current) => {
      if (options?.preserveLocalStale && next.freshness === "synced" && (current === "dirty" || current === "blocked")) {
        return current;
      }
      return next.freshness;
    });
    const latestEvent = next.latestEvent;
    if (latestEvent) {
      setActivityEvents((current) => appendBrowserActivityEvent(current, latestEvent));
    }
  };

  useEffect(() => {
    if (!bridgeActive) {
      return;
    }
    let canceled = false;
    const eventCursorAtRequest = browserEventCursorRef.current;
    void loadBrowserState(sessionId, tRef.current("browserPreviewInvalidResponse"))
      .then((next) => {
        if (canceled || next === null) {
          return;
        }
        applySnapshot(next, { preserveLocalStale: localMirrorDirtyPendingRef.current });
        const agentNavigationUrl = agentNavigationUrlRef.current;
        if (agentNavigationUrl) {
          adoptBrowserUrl(agentNavigationUrl);
        } else if (!userLiveNavigationStartedRef.current && browserEventCursorRef.current === eventCursorAtRequest) {
          adoptBrowserUrl(next.url);
        }
        setError(null);
      })
      .catch((operationError: unknown) => {
        if (canceled) {
          return;
        }
        const message = operationError instanceof Error ? operationError.message : String(operationError);
        setMirrorStatus("error");
        setError(tRef.current("browserPreviewOpenError", { error: message }));
      });
    return () => {
      canceled = true;
    };
  }, [bridgeActive, sessionId]);

  useEffect(() => {
    if (!bridgeActive || typeof EventSource === "undefined") {
      setEventStreamStatus("idle");
      return;
    }
    // Generation guard: events from a previous sessionId's stream must never
    // mutate the current session's state if a stale packet arrives mid-teardown.
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
        // A single malformed frame must not tear down the whole stream; drop it
        // and keep listening (the connection itself is still healthy).
        return;
      }
      if (!isBrowserActivityEvent(parsed) || parsed.sessionId !== sessionId) {
        return;
      }
      browserEventCursorRef.current = Math.max(browserEventCursorRef.current, parsed.id);
      setActivityEvents((current) => appendBrowserActivityEvent(current, parsed));
      if (isReplayableBrowserActivityEvent(parsed)) {
        // Replaying into the live iframe can throw on cross-origin frames or
        // missing DOM APIs; treat any failure as "blocked" without tearing the
        // event stream down.
        let replayed = false;
        suppressFrameDirtyUntilRef.current = Date.now() + 500;
        try {
          replayed = replayBrowserActivityEvent(frameRef.current, parsed);
        } catch {
          replayed = false;
        }
        setLiveReplayBlocked(!replayed);
      }
      if (parsed.url && (parsed.type === "navigation.started" || parsed.type === "navigation.done" || parsed.type === "tab.selected")) {
        agentNavigationUrlRef.current = parsed.url;
        setLiveReplayBlocked(false);
        adoptBrowserUrl(parsed.url);
      }
      if (parsed.url || parsed.title) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                url: parsed.url ?? current.url,
                title: parsed.title ?? current.title,
              }
            : current,
        );
      }
      // The agent (or a window.open in the page) can change the set of tabs; the
      // event itself carries no tab list, so re-pull the snapshot to refresh the
      // strip and active tab.
      if (parsed.type === "tab.created" || parsed.type === "tab.closed" || parsed.type === "tab.selected") {
        void loadBrowserState(sessionId, tRef.current("browserPreviewInvalidResponse"))
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
  }, [bridgeActive, sessionId]);

  const markMirrorDirty = async (reason: string, dirtyUrl?: string) => {
    const blocked = reason.toLowerCase().includes("cross-origin") || reason.toLowerCase().includes("storage blocked");
    localMirrorDirtyPendingRef.current = true;
    setMirrorStatus(blocked ? "blocked" : "dirty");
    try {
      const body = dirtyUrl ? { sessionId, reason, url: dirtyUrl } : { sessionId, reason };
      const next = await postBrowserSnapshot("/api/browser/dirty", body, t("browserPreviewInvalidResponse"));
      applySnapshot(next);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(t("browserPreviewOpenError", { error: message }));
    } finally {
      localMirrorDirtyPendingRef.current = false;
    }
  };

  const syncMirror = async (targetUrl: string) => {
    setMirrorStatus("syncing");
    setError(null);
    try {
      const syncRequest = browserSyncRequest(frameRef.current, sessionId, targetUrl);
      // The frame loads a proxied/rewritten URL, but the server-side mirror reaches
      // the dev server most reliably over loopback — map it back before syncing.
      const mirrorBody = { ...syncRequest.request, url: resolvePreviewMirrorUrl(syncRequest.request.url) };
      const next = await postBrowserSnapshot("/api/browser/sync", mirrorBody, t("browserPreviewInvalidResponse"));
      applySnapshot(next);
      setLiveReplayBlocked(false);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(t("browserPreviewOpenError", { error: message }));
    }
  };

  // Auto-sync: when the live iframe drifts from the mirror (the user interacted
  // with the page), push the change to the Playwright mirror on a short debounce
  // instead of waiting for a manual Sync click. Held in a ref so the effect can
  // depend on the dirty signal alone without re-subscribing every render.
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

  const detachFrameListeners = () => {
    frameListenerCleanupRef.current?.();
    frameListenerCleanupRef.current = null;
  };

  const markDirtyFromFrame = (reason: string) => {
    if (Date.now() < suppressFrameDirtyUntilRef.current) {
      return;
    }
    const currentUrl = readableFrameUrl(frameRef.current) ?? liveUrlRef.current ?? undefined;
    void markMirrorDirty(reason, currentUrl);
  };

  const attachFrameDirtyListeners = (frame: HTMLIFrameElement) => {
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
  };

  const handleFrameLoad = () => {
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
  };

  useEffect(() => {
    return () => {
      detachFrameListeners();
    };
  }, []);

  const openTarget = (rawUrl: string) => {
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
      setError(t("browserPreviewOpenError", { error: message }));
    }
  };

  const open = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    openTarget(url);
  };

  // Open a URL requested from outside (a chat link's "open in preview"). Kept in
  // a ref so the effect can fire on the request nonce alone without re-running on
  // every render that recreates openTarget.
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  useEffect(() => {
    if (openRequest?.url) {
      openTargetRef.current(openRequest.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  const refreshLivePreview = () => {
    if (!liveUrl) {
      return;
    }
    setFrameKey((current) => current + 1);
    void syncMirror(liveUrl);
  };

  const navigateFrameHistory = (direction: "back" | "forward") => {
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
    // Keep the Playwright mirror aligned with the page the iframe just navigated
    // to, otherwise subsequent agent actions target a stale DOM.
    void syncMirror(nextUrl);
  };

  const clearSelection = () => {
    setSelection(null);
    setComponentSelection(null);
    setDragStart(null);
    setSelectionViewport(null);
    setComment("");
  };

  const changeMode = (_event: ReactMouseEvent<HTMLElement>, nextMode: PreviewMode | null) => {
    if (!nextMode) {
      return;
    }
    if (nextMode !== mode) {
      clearSelection();
    }
    setMode(nextMode);
  };

  const sendAnnotation = () => {
    if (!liveUrl) {
      return;
    }
    if (componentSelection && canSendComponent) {
      onSendAnnotation(buildComponentAnnotationMessage({ url: liveUrl, title }, componentSelection, comment));
    } else if (selection && canSendAnnotation) {
      onSendAnnotation(buildAnnotationMessage({ url: liveUrl, title }, selection, comment));
    } else {
      return;
    }
    clearSelection();
    toast({ message: t("browserPreviewAnnotationSent"), severity: "success", duration: 2500 });
  };

  const selectMirrorTab = async (tab: BrowserTab) => {
    try {
      const next = await postBrowserSnapshot(
        "/api/browser/action",
        { sessionId, tabId: tab.id, type: "select-tab" },
        t("browserPreviewInvalidResponse"),
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
      setError(t("browserPreviewOpenError", { error: message }));
    }
  };

  const startSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (!liveUrl || mode !== "annotate") {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextViewport = viewportFromElement(event.currentTarget, snapshot?.viewport);
    setSelectionViewport(nextViewport);
    const point = pointFromPointerEvent(event, nextViewport);
    setDragStart(point);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const moveSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (!selectionViewport || !dragStart) {
      return;
    }
    event.preventDefault();
    setSelection(selectionRectBetween(dragStart, pointFromPointerEvent(event, selectionViewport)));
  };

  const finishSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragStart) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSelection(selection && selection.width >= 4 && selection.height >= 4 ? selection : null);
    setDragStart(null);
  };

  const pickComponent = (event: ReactMouseEvent<HTMLElement>) => {
    if (!liveUrl || mode !== "component") {
      return;
    }
    try {
      const picked = pickBrowserComponent(frameRef.current, event);
      setComponentSelection(picked);
      void cropComponentScreenshot(snapshot?.screenshot, picked.rect, picked.viewport).then((screenshotDataUrl) => {
        if (!screenshotDataUrl) {
          return;
        }
        setComponentSelection((current) => {
          if (!current || current.selector !== picked.selector || current.rect.x !== picked.rect.x || current.rect.y !== picked.rect.y || current.rect.width !== picked.rect.width || current.rect.height !== picked.rect.height) {
            return current;
          }
          return { ...current, screenshotDataUrl };
        });
      });
      setSelection(null);
      setSelectionViewport(null);
      setError(null);
    } catch (pickError) {
      const message = pickError instanceof Error ? pickError.message : String(pickError);
      setComponentSelection(null);
      setError(t("browserPreviewComponentPickError", { error: message }));
    }
  };

  const installPreviewBrowser = () => {
    setInstallingBrowser(true);
    setInstallBrowserError(null);
    void (async () => {
      try {
        const response = await fetch("/api/playwright-install", { method: "POST" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as unknown;
          throw new Error(payloadError(payload, `Playwright install failed (${response.status})`));
        }
        setBrowserInstalled(true);
      } catch (err) {
        setInstallBrowserError(err instanceof Error ? err.message : String(err));
      } finally {
        setInstallingBrowser(false);
      }
    })();
  };

  // Without Playwright's Chromium the Preview can't launch — keep the tab usable
  // by offering an install action instead of a broken browser surface.
  if (active && browserInstalled === false) {
    return (
      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 3,
          backgroundColor: (theme) => theme.custom.surfaces.s1,
          pb: bottomInset > 0 ? `${bottomInset}px` : 0,
        }}
      >
        <EmptyState
          icon={<OpenInBrowserIcon />}
          title={t("browserPreviewMissingTitle")}
          description={t("browserPreviewMissingDescription")}
          action={
            <Stack spacing={1} sx={{ alignItems: "center" }}>
              <Button variant="contained" size="small" disabled={installingBrowser} onClick={installPreviewBrowser}>
                {installingBrowser ? t("installingBrowserPreview") : t("installBrowserPreview")}
              </Button>
              {installBrowserError && (
                <Typography sx={{ fontSize: "0.72rem", maxWidth: 360, textAlign: "center", color: (theme) => theme.palette.status.error.main }}>
                  {t("browserPreviewInstallFailed", { error: installBrowserError })}
                </Typography>
              )}
            </Stack>
          }
        />
      </Box>
    );
  }

  return (
    <Box
      aria-hidden={active ? undefined : "true"}
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: (theme) => theme.custom.surfaces.s1,
        pb: bottomInset > 0 ? `${bottomInset}px` : 0,
      }}
    >
      <Box
        component="form"
        data-testid="browser-preview-browser-bar"
        onSubmit={open}
        sx={{
          flex: "0 0 auto",
          height: 46,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          backgroundColor: (theme) => theme.custom.surfaces.s2,
          // On narrow phones the fixed controls + URL field exceed the width.
          // Let the bar scroll horizontally (hidden scrollbar) so nothing is
          // clipped/unreachable instead of overflowing the viewport.
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {controlTooltip(
          t("browserPreviewBack"),
          <IconButton data-testid="browser-preview-back-button" aria-label={t("browserPreviewBack")} size="small" disabled={!canGoBack} onClick={() => navigateFrameHistory("back")}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>,
        )}
        {controlTooltip(
          t("browserPreviewForward"),
          <IconButton data-testid="browser-preview-forward-button" aria-label={t("browserPreviewForward")} size="small" disabled={!canGoForward} onClick={() => navigateFrameHistory("forward")}>
            <ArrowForwardIcon fontSize="small" />
          </IconButton>,
        )}
        {controlTooltip(
          t("browserPreviewRefresh"),
          <IconButton data-testid="browser-preview-refresh-button" aria-label={t("browserPreviewRefresh")} size="small" disabled={!liveUrl || mirrorSyncing} onClick={refreshLivePreview}>
            <RefreshIcon fontSize="small" />
          </IconButton>,
        )}
        <InputBase
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={browserPreviewDefaultUrl}
          inputProps={{ "aria-label": t("browserPreviewUrlLabel"), "data-testid": "browser-preview-url-input" }}
          sx={{
            flex: "1 1 auto",
            minWidth: 0,
            height: 30,
            maxHeight: 30,
            px: 1.25,
            boxSizing: "border-box",
            alignItems: "center",
            borderRadius: 999,
            backgroundColor: (theme) => theme.custom.surfaces.s1,
            color: "text.primary",
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "0.86rem",
            lineHeight: 1,
            "& input": { height: "100%", boxSizing: "border-box", textAlign: "center", p: 0 },
          }}
        />
        {controlTooltip(
          t("browserPreviewOpen"),
          <IconButton data-testid="browser-preview-open-button" aria-label={t("browserPreviewOpen")} type="submit" size="small" disabled={mirrorSyncing}>
            {mirrorSyncing ? <CircularProgress color="inherit" size={18} /> : <OpenInBrowserIcon fontSize="small" />}
          </IconButton>,
        )}
        <Tooltip title={`${t("browserPreviewSyncMirror")} · ${playwrightStatusLabel}`} enterDelay={0} arrow>
          <Box
            component="button"
            type="button"
            data-testid="browser-preview-sync-button"
            aria-label={`${t("browserPreviewSyncMirror")}: ${playwrightStatusLabel}`}
            aria-disabled={mirrorSyncing || !liveUrl ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (mirrorSyncing || !liveUrl) {
                return;
              }
              void syncMirror(liveUrl);
            }}
            sx={{
              flex: "0 0 auto",
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.45,
              height: 24,
              px: 0.75,
              borderRadius: 999,
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              backgroundColor: (theme) => theme.custom.surfaces.s1,
              color: "text.secondary",
              cursor: mirrorSyncing || !liveUrl ? "default" : "pointer",
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.68rem",
              fontWeight: 900,
              letterSpacing: 0,
              lineHeight: 1,
              opacity: mirrorSyncing || !liveUrl ? 0.72 : 1,
              outline: 0,
              "&:hover": {
                borderColor: mirrorSyncing || !liveUrl ? undefined : (theme) => theme.custom.borders.strong,
                backgroundColor: mirrorSyncing || !liveUrl ? undefined : (theme) => theme.custom.surfaces.s2,
              },
              "&:focus-visible": {
                boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
              },
            }}
          >
            <StatusDot status={mirrorStatusDotStatus(mirrorStatus)} label={playwrightStatusLabel} size="sm" pulse={mirrorStatusDotPulse(mirrorStatus)} />
            <Box component="span" aria-hidden="true" sx={{ color: "text.primary", fontWeight: 900 }}>
              pw
            </Box>
            <Box component="span" aria-hidden="true" sx={{ color: eventStreamStatus === "error" ? "error.main" : "text.secondary", fontWeight: 900 }}>
              {eventStreamStatus === "connected" ? t("browserPreviewEventsLiveShort") : eventStreamStatus === "error" ? t("browserPreviewEventsErrorShort") : t("browserPreviewEventsIdleShort")}
            </Box>
            <Box component="span" sx={visuallyHiddenSx}>
              {mirrorStatusText}
            </Box>
          </Box>
        </Tooltip>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={changeMode}
          aria-label={t("browserPreviewMode")}
          sx={{
            flex: "0 0 auto",
            height: 30,
            "& .MuiToggleButton-root": { width: 30, p: 0, borderColor: (theme) => theme.custom.borders.subtle },
          }}
        >
          {controlTooltip(
            t("browserPreviewInteractMode"),
            <ToggleButton data-testid="browser-preview-mode-interact" value="interact" aria-label={t("browserPreviewInteractMode")}>
              <OpenInBrowserIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
          {controlTooltip(
            t("browserPreviewAnnotateMode"),
            <ToggleButton data-testid="browser-preview-mode-annotate" value="annotate" aria-label={t("browserPreviewAnnotateMode")}>
              <RateReviewIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
          {controlTooltip(
            t("browserPreviewComponentMode"),
            <ToggleButton data-testid="browser-preview-mode-component" value="component" aria-label={t("browserPreviewComponentMode")}>
              <AdsClickIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
        </ToggleButtonGroup>
      </Box>

      {tabs.length > 1 && (
        <Box
          role="tablist"
          aria-label={t("browserPreviewTabsLabel")}
          sx={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 0.5,
            px: 1,
            pt: 0.75,
            overflowX: "auto",
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s1,
            // Hide the horizontal scrollbar while keeping the row scrollable.
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTabId;
            return (
              <Box
                key={tab.id}
                role="tab"
                aria-selected={selected}
                tabIndex={0}
                title={tab.url}
                onClick={() => void selectMirrorTab(tab)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void selectMirrorTab(tab);
                  }
                }}
                sx={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.625,
                  minWidth: 0,
                  maxWidth: 200,
                  height: 30,
                  pl: 1,
                  pr: 1.25,
                  cursor: "pointer",
                  borderTopLeftRadius: (theme) => `${theme.custom.radii.md}px`,
                  borderTopRightRadius: (theme) => `${theme.custom.radii.md}px`,
                  border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                  borderBottom: "none",
                  // The selected tab sits flush over the bottom divider, the rest
                  // recede a row below it.
                  mb: selected ? "-1px" : 0,
                  backgroundColor: (theme) => (selected ? theme.custom.surfaces.s2 : theme.custom.surfaces.s1),
                  color: (theme) => (selected ? theme.palette.text.primary : theme.palette.text.secondary),
                  transition: "background-color 120ms ease, color 120ms ease",
                  "&:hover": { backgroundColor: (theme) => (selected ? theme.custom.surfaces.s2 : theme.custom.surfaces.s3), color: "text.primary" },
                  "&:focus-visible": { outline: (theme) => `2px solid ${theme.custom.borders.focus}`, outlineOffset: -2 },
                  "&::after": selected
                    ? { content: '""', position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundColor: (theme) => theme.palette.status.running.main, borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }
                    : undefined,
                }}
              >
                <PreviewTabFavicon url={tab.url} />
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem" }}>
                  {browserTabLabel(tab)}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ flex: "0 0 auto", m: 1 }}>
          {error}
        </Alert>
      )}
      {liveReplayBlocked && (
        <Alert severity="warning" sx={{ flex: "0 0 auto", m: 1 }}>
          {t("browserPreviewReplayBlocked")}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {liveUrl ? (
          <Box
            data-testid="browser-preview-frame-shell"
            style={{ minHeight: "250px", overflow: "hidden" }}
            sx={{
              flex: "1 1 auto",
              minHeight: 250,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              backgroundColor: (theme) => theme.custom.surfaces.s1,
              userSelect: "none",
              cursor: "auto",
            }}
          >
            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
              <Box
                key={frameKey}
                component="iframe"
                ref={frameRef}
                src={liveUrl}
                title={t("browserPreviewLiveFrameTitle")}
                onLoad={handleFrameLoad}
                sx={{ display: "block", width: "100%", height: "100%", border: 0, pointerEvents: mode === "interact" ? "auto" : "none" }}
              />
              {mode === "annotate" && (
                <Box
                  data-testid="browser-preview-canvas"
                  onPointerDown={startSelection}
                  onPointerMove={moveSelection}
                  onPointerUp={finishSelection}
                  onPointerCancel={finishSelection}
                  sx={{ position: "absolute", inset: 0, zIndex: 1, touchAction: "none" }}
                />
              )}
              {mode === "component" && (
                <Box
                  data-testid="browser-preview-component-canvas"
                  onClick={pickComponent}
                  sx={{ position: "absolute", inset: 0, zIndex: 1 }}
                />
              )}
              {selectionReady && selection && viewport && (
                <Box
                  data-testid="browser-preview-selection-frame"
                  sx={{
                    position: "absolute",
                    zIndex: 2,
                    ...rectSx(selection, viewport),
                    border: (theme) => `2px solid ${theme.palette.status.running.main}`,
                    backgroundColor: (theme) => theme.palette.status.running.soft,
                    boxShadow: (theme) => `0 0 0 1px ${theme.palette.status.running.border}`,
                    pointerEvents: "none",
                  }}
                />
              )}
              {componentReady && componentSelection && (
                <Box
                  data-testid="browser-preview-component-frame"
                  sx={{
                    position: "absolute",
                    zIndex: 2,
                    ...rectSx(componentSelection.rect, componentSelection.viewport),
                    border: (theme) => `2px solid ${theme.palette.status.info.main}`,
                    backgroundColor: (theme) => theme.palette.status.info.soft,
                    boxShadow: (theme) => `0 0 0 1px ${theme.palette.status.info.border}`,
                    pointerEvents: "none",
                  }}
                />
              )}
              {latestPointEvent?.point && snapshot?.viewport && (
                <Box
                  data-testid="browser-preview-action-marker"
                  sx={{
                    position: "absolute",
                    zIndex: 3,
                    left: `${(latestPointEvent.point.x / snapshot.viewport.width) * 100}%`,
                    top: `${(latestPointEvent.point.y / snapshot.viewport.height) * 100}%`,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: (theme) => `2px solid ${theme.palette.status.running.main}`,
                    backgroundColor: (theme) => theme.palette.status.running.soft,
                    boxShadow: (theme) => `0 0 0 5px ${theme.palette.status.running.soft}`,
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </Box>
            {panelState && panelPosition && (
              <Box
                data-testid="browser-preview-annotation-panel"
                data-placement={panelPosition.placement}
                data-selection-kind={panelState.kind}
                sx={{
                  position: "absolute",
                  zIndex: 4,
                  width: annotationPanelWidthCss,
                  maxHeight: "calc(100% - 16px)",
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.75,
                  px: 0.75,
                  py: 0.75,
                  borderRadius: 1,
                  border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                  backgroundColor: (theme) => theme.custom.surfaces.s2,
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.16)",
                  pointerEvents: "auto",
                  ...panelPosition.sx,
                }}
              >
                <Box
                  data-testid="browser-preview-selection-summary"
                  sx={{
                    minWidth: 0,
                    display: "flex",
                    alignItems: "baseline",
                    gap: 0.75,
                    overflow: "hidden",
                  }}
                >
                  <Typography
                    data-testid="browser-preview-selection-label"
                    sx={{
                      minWidth: 0,
                      flex: "0 1 auto",
                      fontFamily: (theme) => theme.custom.fonts.mono,
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {panelState.label}
                  </Typography>
                  <Typography
                    sx={{
                      minWidth: 0,
                      flex: "1 1 auto",
                      fontFamily: (theme) => theme.custom.fonts.mono,
                      fontSize: "0.66rem",
                      color: "text.secondary",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {panelState.description}
                  </Typography>
                </Box>
                {componentSelection?.screenshotDataUrl && (
                  <Box
                    component="img"
                    data-testid="browser-preview-component-screenshot"
                    alt={t("browserPreviewComponentScreenshotAlt")}
                    src={componentSelection.screenshotDataUrl}
                    sx={{
                      width: 96,
                      maxWidth: "100%",
                      maxHeight: 72,
                      objectFit: "contain",
                      alignSelf: "flex-start",
                      borderRadius: 0.75,
                      border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                      backgroundColor: (theme) => theme.custom.surfaces.s1,
                    }}
                  />
                )}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto auto" },
                    alignItems: "center",
                    gap: 0.75,
                  }}
                >
                  <TextField
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    size="small"
                    multiline
                    maxRows={2}
                    placeholder={t("browserPreviewCommentLabel")}
                    slotProps={{ htmlInput: { "aria-label": t("browserPreviewCommentLabel") } }}
                    sx={{
                      minWidth: 0,
                      "& .MuiOutlinedInput-root": { minHeight: 34, p: "4px 8px", alignItems: "center" },
                      "& .MuiOutlinedInput-input": { p: 0, fontSize: "0.82rem", lineHeight: 1.35 },
                    }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SendIcon sx={{ fontSize: 16 }} />}
                    disabled={!(canSendAnnotation || canSendComponent)}
                    onClick={sendAnnotation}
                    sx={{ minWidth: 0, height: 34, px: 1, whiteSpace: "nowrap", "& .MuiButton-startIcon": { mr: 0.5 } }}
                  >
                    {t("browserPreviewSendAnnotation")}
                  </Button>
                  <Button variant="outlined" size="small" onClick={clearSelection} sx={{ minWidth: 0, height: 34, px: 1, whiteSpace: "nowrap" }}>
                    {t("browserPreviewClearSelection")}
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        ) : (
          <Stack sx={{ flex: 1, minHeight: 250, alignItems: "center", justifyContent: "center" }}>
            <EmptyState icon={<OpenInBrowserIcon />} title={t("browserPreviewEmptyTitle")} description={t("browserPreviewEmptyDescription")} />
          </Stack>
        )}
      </Box>
    </Box>
  );
});
