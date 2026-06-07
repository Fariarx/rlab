import AdsClickIcon from "@mui/icons-material/AdsClick";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import { Alert, Box, Button, CircularProgress, IconButton, InputBase, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, useToast } from "../ui";

interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

interface BrowserSnapshot {
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly screenshot: string;
  readonly viewport: BrowserViewport;
  readonly updatedAt: string;
}

interface BrowserPoint {
  readonly x: number;
  readonly y: number;
}

interface BrowserSelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BrowserComponentSelection {
  readonly label: string;
  readonly selector: string;
  readonly text: string;
  readonly rect: BrowserSelectionRect;
  readonly viewport: BrowserViewport;
}

interface BrowserSelectionPanel {
  readonly kind: "region" | "component";
  readonly label: string;
  readonly description: string;
  readonly rect: BrowserSelectionRect;
  readonly viewport: BrowserViewport;
}

interface BrowserPreviewProps {
  readonly active: boolean;
  readonly onSendAnnotation?: (message: string) => void;
  readonly bottomInset?: number;
}

interface BrowserSyncRequest {
  readonly url: string;
  readonly localStorage?: Record<string, string>;
  readonly sessionStorage?: Record<string, string>;
}

interface FrameHistoryState {
  readonly entries: readonly string[];
  readonly index: number;
}

type PreviewMode = "interact" | "annotate" | "component";
type MirrorStatus = "idle" | "syncing" | "synced" | "error";

const tooltippedControlSx = { display: "inline-flex", flex: "0 0 auto" } as const;
const annotationPanelGap = 8;
const annotationPanelEstimatedHeight = 132;
const annotationPanelWidthCss = "min(520px, calc(100% - 16px))";
const annotationPanelHeightCss = "min(132px, calc(100% - 16px))";
const browserPreviewDefaultUrl = "about:blank";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrowserViewport(value: unknown): value is BrowserViewport {
  return isRecord(value) && typeof value.width === "number" && typeof value.height === "number";
}

function isBrowserSnapshot(value: unknown): value is BrowserSnapshot {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.screenshot === "string" &&
    isBrowserViewport(value.viewport) &&
    typeof value.updatedAt === "string"
  );
}

function payloadError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

async function postBrowserSnapshot(endpoint: string, body: object, invalidResponseMessage: string): Promise<BrowserSnapshot> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payloadError(payload, `HTTP ${response.status}`));
  }
  if (!isBrowserSnapshot(payload)) {
    throw new Error(invalidResponseMessage);
  }
  return payload;
}

function storageToRecord(storage: Storage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) {
      result[key] = storage.getItem(key) ?? "";
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeBrowserPreviewUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return browserPreviewDefaultUrl;
  }
  if (raw.toLowerCase() === browserPreviewDefaultUrl) {
    return browserPreviewDefaultUrl;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Browser URL must be an absolute http(s) URL or about:blank.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Browser URL must be an absolute http(s) URL or about:blank.");
  }
  return parsed.toString();
}

function pushFrameHistory(current: FrameHistoryState, nextUrl: string): FrameHistoryState {
  if (current.entries[current.index] === nextUrl) {
    return current;
  }
  const retainedEntries = current.index >= 0 ? current.entries.slice(0, current.index + 1) : [];
  return { entries: [...retainedEntries, nextUrl], index: retainedEntries.length };
}

function viewportFromElement(element: HTMLElement, snapshotViewport: BrowserViewport | undefined): BrowserViewport {
  if (snapshotViewport) {
    return snapshotViewport;
  }
  const bounds = element.getBoundingClientRect();
  return { width: Math.max(Math.round(bounds.width), 1), height: Math.max(Math.round(bounds.height), 1) };
}

function browserSyncRequest(frame: HTMLIFrameElement | null, targetUrl: string): BrowserSyncRequest {
  if (!frame?.contentWindow) {
    return { url: targetUrl };
  }
  try {
    const frameWindow = frame.contentWindow;
    const currentUrl = normalizeBrowserPreviewUrl(frameWindow.location.href);
    if (currentUrl !== targetUrl) {
      return { url: targetUrl };
    }
    return {
      url: currentUrl,
      localStorage: storageToRecord(frameWindow.localStorage),
      sessionStorage: storageToRecord(frameWindow.sessionStorage),
    };
  } catch {
    return { url: targetUrl };
  }
}

function pointFromPointerEvent(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, viewport: BrowserViewport): BrowserPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  const width = bounds.width || 1;
  const height = bounds.height || 1;
  return {
    x: clamp(Math.round(((event.clientX - bounds.left) / width) * viewport.width), 0, viewport.width),
    y: clamp(Math.round(((event.clientY - bounds.top) / height) * viewport.height), 0, viewport.height),
  };
}

function selectionRectBetween(start: BrowserPoint, end: BrowserPoint): BrowserSelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function rectSx(rect: BrowserSelectionRect, viewport: BrowserViewport) {
  return {
    left: `${(rect.x / viewport.width) * 100}%`,
    top: `${(rect.y / viewport.height) * 100}%`,
    width: `${(rect.width / viewport.width) * 100}%`,
    height: `${(rect.height / viewport.height) * 100}%`,
  } as const;
}

function annotationPanelPlacement(rect: BrowserSelectionRect, viewport: BrowserViewport): "above" | "below" {
  const spaceAbove = rect.y;
  const spaceBelow = viewport.height - (rect.y + rect.height);
  if (spaceBelow >= annotationPanelEstimatedHeight + annotationPanelGap) {
    return "below";
  }
  if (spaceAbove >= annotationPanelEstimatedHeight + annotationPanelGap) {
    return "above";
  }
  return spaceBelow >= spaceAbove ? "below" : "above";
}

function annotationPanelSx(rect: BrowserSelectionRect, viewport: BrowserViewport) {
  const placement = annotationPanelPlacement(rect, viewport);
  const centerPercent = ((rect.x + rect.width / 2) / viewport.width) * 100;
  const left = `clamp(8px, calc(${centerPercent}% - (${annotationPanelWidthCss}) / 2), calc(100% - ${annotationPanelWidthCss} - 8px))`;
  if (placement === "above") {
    const bottomPercent = ((viewport.height - rect.y) / viewport.height) * 100;
    return {
      placement,
      sx: {
        left,
        bottom: `clamp(8px, calc(${bottomPercent}% + ${annotationPanelGap}px), calc(100% - ${annotationPanelHeightCss} - 8px))`,
      },
    } as const;
  }
  const topPercent = ((rect.y + rect.height) / viewport.height) * 100;
  return {
    placement,
    sx: {
      left,
      top: `clamp(8px, calc(${topPercent}% + ${annotationPanelGap}px), calc(100% - ${annotationPanelHeightCss} - 8px))`,
    },
  } as const;
}

function quotedAttributeSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

function elementClassNames(element: Element): readonly string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function componentLabelForElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  const classes = elementClassNames(element);
  return `${tagName}${id ? `#${id}` : ""}${classes.length > 0 ? `.${classes.join(".")}` : ""}`;
}

function selectorForElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return quotedAttributeSelector("data-testid", testId);
  }
  const id = element.getAttribute("id");
  if (id) {
    return `#${id}`;
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return `${tagName}${quotedAttributeSelector("aria-label", ariaLabel)}`;
  }
  const role = element.getAttribute("role");
  if (role) {
    return `${tagName}${quotedAttributeSelector("role", role)}`;
  }
  const classes = elementClassNames(element);
  return `${tagName}${classes.length > 0 ? `.${classes.join(".")}` : ""}`;
}

function clippedText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function pickBrowserComponent(frame: HTMLIFrameElement | null, event: ReactMouseEvent<HTMLElement>): BrowserComponentSelection {
  if (!frame?.contentWindow) {
    throw new Error("Iframe is not ready.");
  }
  const overlayBounds = event.currentTarget.getBoundingClientRect();
  const x = clamp(event.clientX - overlayBounds.left, 0, overlayBounds.width);
  const y = clamp(event.clientY - overlayBounds.top, 0, overlayBounds.height);
  const frameWindow = frame.contentWindow;
  const element = frameWindow.document.elementFromPoint(x, y);
  if (!element) {
    throw new Error("No page component under the pointer.");
  }
  const elementBounds = element.getBoundingClientRect();
  const viewport = {
    width: Math.max(Math.round(frameWindow.innerWidth || overlayBounds.width), 1),
    height: Math.max(Math.round(frameWindow.innerHeight || overlayBounds.height), 1),
  };
  return {
    label: componentLabelForElement(element),
    selector: selectorForElement(element),
    text: clippedText(element.textContent ?? ""),
    rect: {
      x: clamp(Math.round(elementBounds.left), 0, viewport.width),
      y: clamp(Math.round(elementBounds.top), 0, viewport.height),
      width: clamp(Math.round(elementBounds.width), 0, viewport.width),
      height: clamp(Math.round(elementBounds.height), 0, viewport.height),
    },
    viewport,
  };
}

function buildAnnotationMessage(target: { readonly url: string; readonly title: string }, rect: BrowserSelectionRect, comment: string): string {
  return [
    "Browser annotation",
    `url: ${target.url}`,
    `title: ${target.title || "-"}`,
    `rect: x=${rect.x} y=${rect.y} width=${rect.width} height=${rect.height}`,
    `comment: ${comment.trim()}`,
  ].join("\n");
}

function buildComponentAnnotationMessage(target: { readonly url: string; readonly title: string }, component: BrowserComponentSelection, comment: string): string {
  return [
    "Browser component annotation",
    `url: ${target.url}`,
    `title: ${target.title || "-"}`,
    `component: ${component.label}`,
    `selector: ${component.selector}`,
    `text: ${component.text || "-"}`,
    `rect: x=${component.rect.x} y=${component.rect.y} width=${component.rect.width} height=${component.rect.height}`,
    `comment: ${comment.trim()}`,
  ].join("\n");
}

export function BrowserPreview({ active, onSendAnnotation, bottomInset = 0 }: BrowserPreviewProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [url, setUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [mode, setMode] = useState<PreviewMode>("interact");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("idle");
  const [frameHistory, setFrameHistory] = useState<FrameHistoryState>({ entries: [], index: -1 });
  const [dragStart, setDragStart] = useState<BrowserPoint | null>(null);
  const [selection, setSelection] = useState<BrowserSelectionRect | null>(null);
  const [componentSelection, setComponentSelection] = useState<BrowserComponentSelection | null>(null);
  const [selectionViewport, setSelectionViewport] = useState<BrowserViewport | null>(null);
  const [comment, setComment] = useState("");
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
  const mirrorStatusText =
    mirrorStatus === "syncing" ? t("browserPreviewMirrorSyncing") : mirrorStatus === "synced" ? t("browserPreviewMirrorSynced") : t("browserPreviewLiveOnly");
  const playwrightStatusLabel =
    mirrorStatus === "syncing"
      ? t("browserPreviewPlaywrightStatusSyncing")
      : mirrorStatus === "synced"
        ? t("browserPreviewPlaywrightStatusSynced")
        : mirrorStatus === "error"
          ? t("browserPreviewPlaywrightStatusError")
          : t("browserPreviewPlaywrightStatusIdle");

  const syncMirror = async (targetUrl: string) => {
    setMirrorStatus("syncing");
    setError(null);
    try {
      const next = await postBrowserSnapshot("/api/browser/sync", browserSyncRequest(frameRef.current, targetUrl), t("browserPreviewInvalidResponse"));
      setSnapshot(next);
      setMirrorStatus("synced");
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(t("browserPreviewOpenError", { error: message }));
    }
  };

  const open = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const normalizedUrl = normalizeBrowserPreviewUrl(url);
      setLiveUrl(normalizedUrl);
      setUrl(normalizedUrl === browserPreviewDefaultUrl ? "" : normalizedUrl);
      setFrameKey((current) => current + 1);
      setFrameHistory((current) => pushFrameHistory(current, normalizedUrl));
      setMode("interact");
      clearSelection();
      void syncMirror(normalizedUrl);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : String(validationError);
      setError(t("browserPreviewOpenError", { error: message }));
    }
  };

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
    setLiveUrl(nextUrl);
    setUrl(nextUrl === browserPreviewDefaultUrl ? "" : nextUrl);
    setFrameKey((current) => current + 1);
    setError(null);
    setMirrorStatus("idle");
    clearSelection();
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
      setComponentSelection(pickBrowserComponent(frameRef.current, event));
      setSelection(null);
      setSelectionViewport(null);
      setError(null);
    } catch (pickError) {
      const message = pickError instanceof Error ? pickError.message : String(pickError);
      setComponentSelection(null);
      setError(t("browserPreviewComponentPickError", { error: message }));
    }
  };

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
        }}
      >
        {controlTooltip(
          t("browserPreviewBack"),
          <IconButton aria-label={t("browserPreviewBack")} size="small" disabled={!canGoBack} onClick={() => navigateFrameHistory("back")}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>,
        )}
        {controlTooltip(
          t("browserPreviewForward"),
          <IconButton aria-label={t("browserPreviewForward")} size="small" disabled={!canGoForward} onClick={() => navigateFrameHistory("forward")}>
            <ArrowForwardIcon fontSize="small" />
          </IconButton>,
        )}
        {controlTooltip(
          t("browserPreviewRefresh"),
          <IconButton aria-label={t("browserPreviewRefresh")} size="small" disabled={!liveUrl || mirrorSyncing} onClick={refreshLivePreview}>
            <RefreshIcon fontSize="small" />
          </IconButton>,
        )}
        <InputBase
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={browserPreviewDefaultUrl}
          inputProps={{ "aria-label": t("browserPreviewUrlLabel") }}
          sx={{
            flex: "1 1 auto",
            minWidth: 80,
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
        <Tooltip title={playwrightStatusLabel} enterDelay={0} arrow>
          <Box
            component="span"
            role="status"
            aria-label={playwrightStatusLabel}
            sx={{
              flex: "0 0 auto",
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.55,
              height: 24,
              px: 0.75,
              borderRadius: 999,
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              backgroundColor: (theme) => theme.custom.surfaces.s1,
              color: "text.secondary",
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.68rem",
              fontWeight: 800,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: (theme) =>
                  mirrorStatus === "syncing"
                    ? theme.palette.status.running.main
                    : mirrorStatus === "synced"
                      ? theme.palette.status.ok.main
                      : mirrorStatus === "error"
                        ? theme.palette.status.error.main
                        : theme.palette.status.idle.main,
                boxShadow: (theme) =>
                  mirrorStatus === "syncing"
                    ? `0 0 0 3px ${theme.palette.status.running.soft}`
                    : mirrorStatus === "error"
                      ? `0 0 0 3px ${theme.palette.status.error.soft}`
                      : "none",
              }}
            />
            PW
            <Box component="span" sx={visuallyHiddenSx}>
              {mirrorStatusText}
            </Box>
          </Box>
        </Tooltip>
        {controlTooltip(
          t("browserPreviewOpen"),
          <IconButton aria-label={t("browserPreviewOpen")} type="submit" size="small" disabled={mirrorSyncing}>
            {mirrorSyncing ? <CircularProgress color="inherit" size={18} /> : <OpenInBrowserIcon fontSize="small" />}
          </IconButton>,
        )}
        {liveUrl && (
          controlTooltip(
            t("browserPreviewSyncMirror"),
            <IconButton aria-label={t("browserPreviewSyncMirror")} size="small" disabled={mirrorSyncing} onClick={() => void syncMirror(liveUrl)}>
              <RefreshIcon fontSize="small" />
            </IconButton>,
          )
        )}
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
            <ToggleButton value="interact" aria-label={t("browserPreviewInteractMode")}>
              <OpenInBrowserIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
          {controlTooltip(
            t("browserPreviewAnnotateMode"),
            <ToggleButton value="annotate" aria-label={t("browserPreviewAnnotateMode")}>
              <RateReviewIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
          {controlTooltip(
            t("browserPreviewComponentMode"),
            <ToggleButton value="component" aria-label={t("browserPreviewComponentMode")}>
              <AdsClickIcon sx={{ fontSize: 16 }} />
            </ToggleButton>,
          )}
        </ToggleButtonGroup>
      </Box>

      {error && (
        <Alert severity="error" sx={{ flex: "0 0 auto", m: 1 }}>
          {error}
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
}
