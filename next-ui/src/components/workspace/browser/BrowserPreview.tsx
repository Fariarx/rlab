import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import SendIcon from "@mui/icons-material/Send";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadBrowserState, postBrowserSnapshot } from "../../../client/api/browser-preview-api";
import {
  appendBrowserActivityEvent,
  browserPreviewSnapshotApplication,
  browserPreviewStatusLabelKeys,
  type BrowserPreviewProps,
  type BrowserSnapshot,
} from "../../../lib/browser-preview-model";
import { isReplayableBrowserActivityEvent, replayBrowserActivityEvent } from "./browser-preview-live-replay";
import { BrowserPreviewStore } from "./browser-preview-store";
import { BrowserPreviewTabs } from "./BrowserPreviewTabs";
import { BrowserPreviewToolbar } from "./BrowserPreviewToolbar";
import { annotationPanelWidthCss, rectSx } from "./browser-preview-selection";
import { useBrowserPreviewAnnotation } from "./use-browser-preview-annotation";
import { useBrowserPreviewEventStream } from "./use-browser-preview-event-stream";
import { useBrowserPreviewFrameSync } from "./use-browser-preview-frame-sync";
import { useBrowserPreviewInitialStateLoad } from "./use-browser-preview-initial-state-load";
import { useBrowserPreviewInstallController } from "./use-browser-preview-install-controller";
import { useBrowserPreviewNavigation } from "./use-browser-preview-navigation";
import { useI18n } from "../../../i18n/I18nProvider";
import { EmptyState, useToast } from "../../ui";

export type { BrowserActivityEvent } from "../../../lib/browser-preview-model";

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
  const title = useMemo(() => snapshot?.title || liveUrl || t("browserPreviewTitle"), [liveUrl, snapshot, t]);
  const {
    annotationState,
    clearSelection,
    changeMode,
    finishSelection,
    moveSelection,
    panelPosition,
    panelState,
    pickComponent,
    sendAnnotation,
    startSelection,
    viewport,
  } = useBrowserPreviewAnnotation({
    comment,
    componentSelection,
    dragStart,
    frameRef,
    liveUrl,
    mode,
    onAnnotationSent: () => {
      toast({ message: t("browserPreviewAnnotationSent"), severity: "success", duration: 2500 });
    },
    onSendAnnotation,
    selection,
    selectionViewport,
    setComment,
    setComponentSelection,
    setDragStart,
    setError,
    setMode,
    setSelection,
    setSelectionViewport,
    snapshot,
    t,
    title,
  });
  const { selectionReady, componentReady, canSendAnnotation, canSendComponent } = annotationState;
  const mirrorSyncing = mirrorStatus === "syncing";
  const canGoBack = frameHistory.index > 0;
  const canGoForward = frameHistory.index >= 0 && frameHistory.index < frameHistory.entries.length - 1;
  const latestPointEvent = [...activityEvents].reverse().find((event) => event.type === "action.click" && event.point);
  const statusLabelKeys = browserPreviewStatusLabelKeys(mirrorStatus, snapshot?.freshnessReason);
  const mirrorStatusText = t(statusLabelKeys.mirrorStatusKey);
  const playwrightStatusLabel = t(statusLabelKeys.playwrightStatusKey);
  const browserPreviewOpenErrorMessage = useCallback((message: string) => tRef.current("browserPreviewOpenError", { error: message }), []);

  useEffect(() => {
    liveUrlRef.current = liveUrl;
  }, [liveUrl]);

  useEffect(() => {
    // `sessionId` resets per-session browser activity that lives in refs.
    void sessionId;
    browserEventCursorRef.current = 0;
    agentNavigationUrlRef.current = null;
    setActivityEvents([]);
  }, [sessionId, setActivityEvents]);

  useEffect(() => {
    onActivityEventsChange?.(activityEvents);
  }, [activityEvents, onActivityEventsChange]);

  const { installPreviewBrowser } = useBrowserPreviewInstallController({
    active,
    browserInstalled,
    setBrowserInstalled,
    setInstallBrowserError,
    setInstallingBrowser,
  });

  const applySnapshot = useCallback((next: BrowserSnapshot, options?: { readonly preserveLocalStale?: boolean }) => {
    const applied = browserPreviewSnapshotApplication("idle", next);
    setSnapshot(applied.snapshot);
    setTabs(applied.tabs);
    setActiveTabId(applied.activeTabId);
    setMirrorStatus((current) => {
      return browserPreviewSnapshotApplication(current, next, options).mirrorStatus;
    });
    const latestEvent = applied.latestEvent;
    if (latestEvent) {
      setActivityEvents((current) => appendBrowserActivityEvent(current, latestEvent));
    }
  }, [setActiveTabId, setActivityEvents, setMirrorStatus, setSnapshot, setTabs]);

  const { handleFrameLoad, syncMirror } = useBrowserPreviewFrameSync({
    active,
    applySnapshot,
    frameRef,
    invalidResponseMessage: t("browserPreviewInvalidResponse"),
    liveUrl,
    liveUrlRef,
    localMirrorDirtyPendingRef,
    mirrorStatus,
    openErrorMessage: browserPreviewOpenErrorMessage,
    postBrowserSnapshot,
    sessionId,
    setError,
    setFrameHistory,
    setLiveReplayBlocked,
    setLiveUrl,
    setMirrorStatus,
    setUrl,
    suppressFrameDirtyUntilRef,
  });

  const { adoptBrowserUrl, navigateFrameHistory, open, refreshLivePreview, selectMirrorTab } = useBrowserPreviewNavigation({
    applySnapshot,
    clearSelection,
    frameHistory,
    invalidResponseMessage: t("browserPreviewInvalidResponse"),
    liveUrl,
    liveUrlRef,
    openErrorMessage: (message) => t("browserPreviewOpenError", { error: message }),
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
  });

  useBrowserPreviewInitialStateLoad({
    adoptBrowserUrl,
    agentNavigationUrlRef,
    applySnapshot,
    bridgeActive,
    browserEventCursorRef,
    invalidResponseMessage: t("browserPreviewInvalidResponse"),
    loadBrowserState,
    localMirrorDirtyPendingRef,
    openErrorMessage: (message) => t("browserPreviewOpenError", { error: message }),
    sessionId,
    setError,
    setMirrorStatus,
    userLiveNavigationStartedRef,
  });

  useBrowserPreviewEventStream({
    adoptBrowserUrl,
    applySnapshot,
    bridgeActive,
    browserEventCursorRef,
    frameRef,
    invalidResponseMessage: t("browserPreviewInvalidResponse"),
    isReplayableBrowserActivityEvent,
    liveReplaySuppressionUntilRef: suppressFrameDirtyUntilRef,
    loadBrowserState,
    localMirrorDirtyPendingRef,
    navigationUrlRef: agentNavigationUrlRef,
    replayBrowserActivityEvent,
    sessionId,
    setActivityEvents,
    setEventStreamStatus,
    setLiveReplayBlocked,
    setSnapshot,
  });

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
      <BrowserPreviewToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        eventStreamStatus={eventStreamStatus}
        liveUrl={liveUrl}
        mirrorStatus={mirrorStatus}
        mirrorStatusText={mirrorStatusText}
        mirrorSyncing={mirrorSyncing}
        mode={mode}
        onBack={() => navigateFrameHistory("back")}
        onForward={() => navigateFrameHistory("forward")}
        onModeChange={changeMode}
        onOpen={open}
        onRefresh={refreshLivePreview}
        onSyncMirror={() => liveUrl && void syncMirror(liveUrl)}
        onUrlChange={setUrl}
        playwrightStatusLabel={playwrightStatusLabel}
        t={t}
        url={url}
      />

      <BrowserPreviewTabs tabs={tabs} activeTabId={activeTabId} onSelectTab={(tab) => void selectMirrorTab(tab)} t={t} />

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
