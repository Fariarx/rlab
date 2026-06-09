import AdsClickIcon from "@mui/icons-material/AdsClick";
import LanguageIcon from "@mui/icons-material/Language";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import { Alert, Box, Button, CircularProgress, IconButton, InputBase, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, StatusDot, useToast } from "../ui";

interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

type BrowserPreviewFreshness = "synced" | "dirty" | "blocked" | "syncing" | "error";

interface BrowserSnapshot {
  readonly sessionId: string;
  readonly activeTabId: string;
  readonly tabs: readonly BrowserTab[];
  readonly latestEvent?: BrowserActivityEvent;
  readonly freshness: BrowserPreviewFreshness;
  readonly freshnessReason?: string;
  readonly url: string;
  readonly title: string;
  readonly screenshot?: string;
  readonly viewport: BrowserViewport;
  readonly updatedAt: string;
}

interface BrowserTab {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

type BrowserActivityEventType =
  | "session.created"
  | "tab.created"
  | "tab.selected"
  | "tab.closed"
  | "navigation.started"
  | "navigation.done"
  | "action.navigate"
  | "action.go-back"
  | "action.go-forward"
  | "action.refresh"
  | "action.scroll"
  | "action.click"
  | "action.fill"
  | "action.clear"
  | "action.check"
  | "action.uncheck"
  | "action.select"
  | "action.wait-for"
  | "action.hover"
  | "action.type"
  | "action.press"
  | "action.eval"
  | "action.failed"
  | "console.error"
  | "page.error"
  | "network.failed";

interface BrowserActionFrameTarget {
  readonly framePath?: readonly string[];
}

type BrowserActionTarget =
  | (BrowserActionFrameTarget & { readonly selector: string })
  | (BrowserActionFrameTarget & { readonly role: string; readonly name?: string })
  | (BrowserActionFrameTarget & { readonly text: string })
  | (BrowserActionFrameTarget & { readonly label: string });

interface BrowserActivityEvent {
  readonly id: number;
  readonly sessionId: string;
  readonly tabId: string;
  readonly type: BrowserActivityEventType;
  readonly label: string;
  readonly detail?: string;
  readonly url?: string;
  readonly title?: string;
  readonly point?: BrowserPoint;
  readonly deltaY?: number;
  readonly target?: BrowserActionTarget;
  readonly selector?: string;
  readonly text?: string;
  readonly key?: string;
  readonly script?: string;
  readonly at: string;
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
  readonly sessionId: string;
  readonly active: boolean;
  readonly onSendAnnotation?: (message: string) => void;
  readonly bottomInset?: number;
  /** External request to open a URL (e.g. from a chat link's "open in preview").
   *  The nonce changes per request so re-opening the same URL re-triggers. */
  readonly openRequest?: { readonly url: string; readonly nonce: number };
  /** Optional host[:port] to rewrite loopback dev URLs to (Settings override).
   *  Empty ⇒ route loopback URLs through rlab's same-origin proxy instead. */
  readonly serverHostOverride?: string;
}

interface BrowserSyncRequest {
  readonly sessionId: string;
  readonly url: string;
  readonly localStorage?: Record<string, string>;
  readonly sessionStorage?: Record<string, string>;
}

interface BrowserSyncRequestResult {
  readonly request: BrowserSyncRequest;
  readonly blockedReason?: string;
}

interface FrameHistoryState {
  readonly entries: readonly string[];
  readonly index: number;
}

type PreviewMode = "interact" | "annotate" | "component";
type MirrorStatus = "idle" | BrowserPreviewFreshness;
type EventStreamStatus = "idle" | "connected" | "error";

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

function isBrowserPoint(value: unknown): value is BrowserPoint {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isBrowserActionTarget(value: unknown): value is BrowserActionTarget {
  if (!isRecord(value)) {
    return false;
  }
  const framePath =
    value.framePath === undefined ||
    (Array.isArray(value.framePath) && value.framePath.every((item) => typeof item === "string" && item.trim().length > 0));
  const selector = typeof value.selector === "string" && value.selector.trim().length > 0;
  const role = typeof value.role === "string" && value.role.trim().length > 0;
  const text = typeof value.text === "string" && value.text.trim().length > 0;
  const label = typeof value.label === "string" && value.label.trim().length > 0;
  return framePath && [selector, role, text, label].filter(Boolean).length === 1 && (value.name === undefined || typeof value.name === "string");
}

function isBrowserTab(value: unknown): value is BrowserTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.active === "boolean"
  );
}

function isBrowserActivityEventType(value: unknown): value is BrowserActivityEventType {
  return (
    value === "session.created" ||
    value === "tab.created" ||
    value === "tab.selected" ||
    value === "tab.closed" ||
    value === "navigation.started" ||
    value === "navigation.done" ||
    value === "action.navigate" ||
    value === "action.go-back" ||
    value === "action.go-forward" ||
    value === "action.refresh" ||
    value === "action.scroll" ||
    value === "action.click" ||
    value === "action.fill" ||
    value === "action.clear" ||
    value === "action.check" ||
    value === "action.uncheck" ||
    value === "action.select" ||
    value === "action.wait-for" ||
    value === "action.hover" ||
    value === "action.type" ||
    value === "action.press" ||
    value === "action.eval" ||
    value === "action.failed" ||
    value === "console.error" ||
    value === "page.error" ||
    value === "network.failed"
  );
}

function isBrowserPreviewFreshness(value: unknown): value is BrowserPreviewFreshness {
  return value === "synced" || value === "dirty" || value === "blocked" || value === "syncing" || value === "error";
}

function isBrowserActivityEvent(value: unknown): value is BrowserActivityEvent {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.sessionId === "string" &&
    typeof value.tabId === "string" &&
    isBrowserActivityEventType(value.type) &&
    typeof value.label === "string" &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.point === undefined || isBrowserPoint(value.point)) &&
    (value.deltaY === undefined || typeof value.deltaY === "number") &&
    (value.target === undefined || isBrowserActionTarget(value.target)) &&
    (value.selector === undefined || typeof value.selector === "string") &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.key === undefined || typeof value.key === "string") &&
    (value.script === undefined || typeof value.script === "string") &&
    typeof value.at === "string"
  );
}

function isBrowserSnapshot(value: unknown): value is BrowserSnapshot {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.activeTabId === "string" &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isBrowserTab) &&
    (value.latestEvent === undefined || isBrowserActivityEvent(value.latestEvent)) &&
    isBrowserPreviewFreshness(value.freshness) &&
    (value.freshnessReason === undefined || typeof value.freshnessReason === "string") &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    (value.screenshot === undefined || typeof value.screenshot === "string") &&
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

async function loadBrowserState(sessionId: string, invalidResponseMessage: string): Promise<BrowserSnapshot | null> {
  const response = await fetch(`/api/browser/bridge/snapshot?sessionId=${encodeURIComponent(sessionId)}`, { method: "GET", cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payloadError(payload, invalidResponseMessage));
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

const localPreviewHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const previewProxyPrefix = "/preview-proxy";

/** True for loopback hosts the user's browser can't reach when rlab is remote. */
function isLocalPreviewHost(hostname: string): boolean {
  return localPreviewHosts.has(hostname.toLowerCase());
}

/** The URL the live iframe should load. Loopback dev URLs the agent opens are
 *  unreachable from the user's browser when rlab is remote, so they're rewritten
 *  to a configured host (override) or routed through rlab's same-origin proxy.
 *  Non-loopback URLs (and about:blank) pass through untouched. Idempotent. */
function resolvePreviewFrameUrl(rawUrl: string, serverHostOverride: string): string {
  if (rawUrl === browserPreviewDefaultUrl) {
    return rawUrl;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (!isLocalPreviewHost(parsed.hostname)) {
    return rawUrl;
  }
  const override = serverHostOverride.trim();
  if (override) {
    const hostPort = override.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").trim();
    if (!hostPort) {
      return rawUrl;
    }
    if (hostPort.includes(":")) {
      parsed.host = hostPort;
    } else {
      parsed.hostname = hostPort;
    }
    return parsed.toString();
  }
  // No override: only route through the same-origin proxy when rlab itself is
  // served from a remote host. A locally-served rlab can reach loopback dev
  // servers directly, so the URL is left untouched.
  if (typeof window === "undefined" || isLocalPreviewHost(window.location.hostname)) {
    return rawUrl;
  }
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `${window.location.origin}${previewProxyPrefix}/${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Maps a frame URL back to a form the server-side Playwright mirror can load.
 *  Same-origin proxy URLs become a direct loopback URL (the mirror runs on the
 *  same machine as the dev server); everything else is already reachable. */
function resolvePreviewMirrorUrl(frameUrl: string): string {
  const proxyMatch = /\/preview-proxy\/(\d{1,5})(\/.*)?$/.exec(frameUrl);
  if (proxyMatch && typeof window !== "undefined" && frameUrl.startsWith(window.location.origin)) {
    return `http://127.0.0.1:${proxyMatch[1]}${proxyMatch[2] ?? "/"}`;
  }
  return frameUrl;
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

function readableFrameUrl(frame: HTMLIFrameElement | null): string | null {
  if (!frame?.contentWindow) {
    return null;
  }
  try {
    return normalizeBrowserPreviewUrl(frame.contentWindow.location.href);
  } catch {
    return null;
  }
}

function browserSyncRequest(frame: HTMLIFrameElement | null, sessionId: string, targetUrl: string): BrowserSyncRequestResult {
  if (!frame?.contentWindow) {
    return { request: { sessionId, url: targetUrl } };
  }
  try {
    const frameWindow = frame.contentWindow;
    const currentUrl = normalizeBrowserPreviewUrl(frameWindow.location.href);
    if (currentUrl !== targetUrl) {
      return { request: { sessionId, url: targetUrl } };
    }
    return {
      request: {
        sessionId,
        url: currentUrl,
        localStorage: storageToRecord(frameWindow.localStorage),
        sessionStorage: storageToRecord(frameWindow.sessionStorage),
      },
    };
  } catch {
    return { request: { sessionId, url: targetUrl }, blockedReason: "cross-origin iframe" };
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

function appendBrowserActivityEvent(events: readonly BrowserActivityEvent[], event: BrowserActivityEvent): readonly BrowserActivityEvent[] {
  const withoutDuplicate = events.filter((item) => item.id !== event.id);
  return [...withoutDuplicate, event].sort((a, b) => a.id - b.id).slice(-8);
}

function browserEventTone(type: BrowserActivityEventType): "info" | "success" | "warning" | "error" {
  if (type === "console.error" || type === "page.error" || type === "network.failed") {
    return "error";
  }
  if (type === "navigation.done" || type === "tab.selected") {
    return "success";
  }
  if (type === "navigation.started") {
    return "warning";
  }
  return "info";
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
function PreviewTabFavicon({ url }: { readonly url: string }) {
  const [failed, setFailed] = useState(false);
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
}

function liveFrameDocument(frame: HTMLIFrameElement | null): Document | null {
  if (!frame?.contentWindow) {
    return null;
  }
  try {
    return frame.contentWindow.document;
  } catch {
    return null;
  }
}

function dispatchLiveInput(element: Element, text: string): boolean {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea") {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    const canSelectText = input instanceof view.HTMLTextAreaElement || ["email", "password", "search", "tel", "text", "url"].includes((input as HTMLInputElement).type);
    const start = canSelectText ? input.selectionStart ?? input.value.length : input.value.length;
    const end = canSelectText ? input.selectionEnd ?? start : start;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const nextPosition = start + text.length;
    if (canSelectText) {
      input.setSelectionRange(nextPosition, nextPosition);
    }
    input.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
    return true;
  }
  const editable = element as HTMLElement;
  if (editable.isContentEditable) {
    editable.focus();
    editable.textContent = `${editable.textContent ?? ""}${text}`;
    editable.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }
  return false;
}

function dispatchLiveFill(element: Element, text: string): boolean {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea") {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.value = text;
    const canSelectText = input instanceof view.HTMLTextAreaElement || ["email", "password", "search", "tel", "text", "url"].includes((input as HTMLInputElement).type);
    if (canSelectText) {
      input.setSelectionRange(text.length, text.length);
    }
    input.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
    return true;
  }
  const editable = element as HTMLElement;
  if (editable.isContentEditable) {
    editable.focus();
    editable.textContent = text;
    editable.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    return true;
  }
  return false;
}

function dispatchLiveCheck(element: Element, checked: boolean): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLInputElement) || (element.type !== "checkbox" && element.type !== "radio")) {
    return false;
  }
  element.focus();
  element.checked = checked;
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  return true;
}

function dispatchLiveSelect(element: Element, optionText: string): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLSelectElement)) {
    return false;
  }
  const option = Array.from(element.options).find((item) => item.value === optionText || item.label === optionText || normalizedLiveText(item.textContent) === optionText);
  if (!option) {
    return false;
  }
  element.focus();
  element.value = option.value;
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  return true;
}

function dispatchLiveHover(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, view, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  element.dispatchEvent(new view.MouseEvent("mouseover", mouseInit));
  element.dispatchEvent(new view.MouseEvent("mousemove", mouseInit));
  return true;
}

function normalizedLiveText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function implicitLiveRole(element: Element): string | null {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") {
    return "button";
  }
  if (tagName === "a" && element.hasAttribute("href")) {
    return "link";
  }
  if (tagName === "textarea") {
    return "textbox";
  }
  if (tagName === "select") {
    return "combobox";
  }
  if (tagName === "input") {
    const input = element as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") {
      return input.type;
    }
    if (input.type === "button" || input.type === "submit" || input.type === "reset") {
      return "button";
    }
    return "textbox";
  }
  return null;
}

function liveElementName(element: Element): string {
  const ariaLabel = normalizedLiveText(element.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const label = normalizedLiveText(Array.from(control.labels ?? []).map((item) => item.textContent ?? "").join(" "));
    if (label) {
      return label;
    }
    if ("placeholder" in control) {
      const placeholder = normalizedLiveText(String(control.placeholder ?? ""));
      if (placeholder) {
        return placeholder;
      }
    }
  }
  return normalizedLiveText(element.textContent) || normalizedLiveText(element.getAttribute("title"));
}

function liveTargetDocument(rootDocument: Document, target: BrowserActionTarget): Document | null {
  let document = rootDocument;
  for (const frameSelector of target.framePath ?? []) {
    const frame = document.querySelector(frameSelector);
    const view = document.defaultView;
    if (!view || !(frame instanceof view.HTMLIFrameElement)) {
      return null;
    }
    try {
      const nextDocument = frame.contentDocument ?? frame.contentWindow?.document ?? null;
      if (!nextDocument) {
        return null;
      }
      document = nextDocument;
    } catch {
      return null;
    }
  }
  return document;
}

function resolveLiveTarget(rootDocument: Document, target: BrowserActionTarget): Element | null {
  const document = liveTargetDocument(rootDocument, target);
  if (!document) {
    return null;
  }
  if ("selector" in target) {
    return document.querySelector(target.selector);
  }
  const candidates = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,summary,[role],[tabindex],[aria-label],[contenteditable=true]"));
  if ("role" in target) {
    return (
      candidates.find((element) => {
        const role = element.getAttribute("role") ?? implicitLiveRole(element);
        if (role !== target.role) {
          return false;
        }
        return target.name ? liveElementName(element) === target.name : true;
      }) ?? null
    );
  }
  if ("text" in target) {
    return candidates.find((element) => normalizedLiveText(element.textContent) === target.text) ?? null;
  }
  return candidates.find((element) => liveElementName(element) === target.label) ?? null;
}

function dispatchLiveClickOnElement(element: Element): boolean {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const x = Math.max(0, rect.x + rect.width / 2);
  const y = Math.max(0, rect.y + rect.height / 2);
  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0 };
  element.dispatchEvent(new view.MouseEvent("pointerdown", mouseInit));
  element.dispatchEvent(new view.MouseEvent("mousedown", mouseInit));
  if (element instanceof view.HTMLElement) {
    element.focus();
  }
  element.dispatchEvent(new view.MouseEvent("pointerup", mouseInit));
  element.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
  element.dispatchEvent(new view.MouseEvent("click", mouseInit));
  return true;
}

function dispatchLiveClick(document: Document, point: BrowserPoint): boolean {
  const view = document.defaultView;
  if (!view) {
    return false;
  }
  const x = Math.max(0, point.x);
  const y = Math.max(0, point.y);
  const target = document.elementFromPoint(x, y);
  if (!target) {
    return false;
  }
  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new view.MouseEvent("pointerdown", mouseInit));
  target.dispatchEvent(new view.MouseEvent("mousedown", mouseInit));
  if (target instanceof view.HTMLElement) {
    target.focus();
  }
  target.dispatchEvent(new view.MouseEvent("pointerup", mouseInit));
  target.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
  target.dispatchEvent(new view.MouseEvent("click", mouseInit));
  return true;
}

function dispatchLiveKey(document: Document, key: string): boolean {
  const view = document.defaultView;
  const target = document.activeElement ?? document.body;
  if (!view || !target) {
    return false;
  }
  const keyboardInit: KeyboardEventInit = { bubbles: true, cancelable: true, key };
  target.dispatchEvent(new view.KeyboardEvent("keydown", keyboardInit));
  target.dispatchEvent(new view.KeyboardEvent("keyup", keyboardInit));
  return true;
}

function replayBrowserActivityEvent(frame: HTMLIFrameElement | null, event: BrowserActivityEvent): boolean {
  const document = liveFrameDocument(frame);
  if (!document) {
    return false;
  }
  const view = document.defaultView;
  if (!view) {
    return false;
  }
  if (event.type === "action.click" && event.target) {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveClickOnElement(target) : false;
  }
  if (event.type === "action.click" && event.point) {
    return dispatchLiveClick(document, event.point);
  }
  if (event.type === "action.scroll" && typeof event.deltaY === "number") {
    if (event.target) {
      const target = resolveLiveTarget(document, event.target);
      const targetView = target?.ownerDocument.defaultView;
      if (!target || !targetView || !(target instanceof targetView.HTMLElement)) {
        return false;
      }
      target.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
      return true;
    }
    view.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
    return true;
  }
  if (event.type === "action.type" && typeof event.text === "string") {
    const target = event.target ? resolveLiveTarget(document, event.target) : event.selector ? document.querySelector(event.selector) : document.activeElement;
    return target ? dispatchLiveInput(target, event.text) : false;
  }
  if (event.type === "action.fill" && event.target && typeof event.text === "string") {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveFill(target, event.text) : false;
  }
  if (event.type === "action.clear" && event.target) {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveFill(target, "") : false;
  }
  if (event.type === "action.check" && event.target) {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveCheck(target, true) : false;
  }
  if (event.type === "action.uncheck" && event.target) {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveCheck(target, false) : false;
  }
  if (event.type === "action.select" && event.target && typeof event.text === "string") {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveSelect(target, event.text) : false;
  }
  if (event.type === "action.hover" && event.target) {
    const target = resolveLiveTarget(document, event.target);
    return target ? dispatchLiveHover(target) : false;
  }
  if (event.type === "action.press" && typeof event.key === "string") {
    let keyDocument = document;
    if (event.target) {
      const target = resolveLiveTarget(document, event.target);
      if (!target) {
        return false;
      }
      keyDocument = target.ownerDocument;
      const targetView = target.ownerDocument.defaultView;
      if (targetView && target instanceof targetView.HTMLElement) {
        target.focus();
      }
    }
    return dispatchLiveKey(keyDocument, event.key);
  }
  if (event.type === "action.eval" && typeof event.script === "string") {
    view.eval(event.script);
    return true;
  }
  // A replayable event reached here only if it was missing its payload (e.g. a
  // click with neither target nor point) — report it as not replayed.
  return false;
}

function isReplayableBrowserActivityEvent(event: BrowserActivityEvent): boolean {
  return (
    event.type === "action.click" ||
    event.type === "action.scroll" ||
    event.type === "action.fill" ||
    event.type === "action.clear" ||
    event.type === "action.check" ||
    event.type === "action.uncheck" ||
    event.type === "action.select" ||
    event.type === "action.hover" ||
    event.type === "action.type" ||
    event.type === "action.press" ||
    event.type === "action.eval"
  );
}

export function BrowserPreview({ sessionId, active, onSendAnnotation, bottomInset = 0, openRequest, serverHostOverride = "" }: BrowserPreviewProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameListenerCleanupRef = useRef<(() => void) | null>(null);
  const suppressFrameDirtyUntilRef = useRef(0);
  const [url, setUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const liveUrlRef = useRef<string | null>(null);
  const userLiveNavigationStartedRef = useRef(false);
  const [frameKey, setFrameKey] = useState(0);
  const [mode, setMode] = useState<PreviewMode>("interact");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [tabs, setTabs] = useState<readonly BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<readonly BrowserActivityEvent[]>([]);
  const [eventStreamStatus, setEventStreamStatus] = useState<EventStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveReplayBlocked, setLiveReplayBlocked] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("idle");
  const [frameHistory, setFrameHistory] = useState<FrameHistoryState>({ entries: [], index: -1 });
  const [dragStart, setDragStart] = useState<BrowserPoint | null>(null);
  const [selection, setSelection] = useState<BrowserSelectionRect | null>(null);
  const [componentSelection, setComponentSelection] = useState<BrowserComponentSelection | null>(null);
  const [selectionViewport, setSelectionViewport] = useState<BrowserViewport | null>(null);
  const [comment, setComment] = useState("");
  // Preview is powered by Playwright's Chromium. Track whether the browser binary
  // is installed so we can show an install CTA instead of a broken browser bar.
  const [browserInstalled, setBrowserInstalled] = useState<boolean | null>(null);
  const [installingBrowser, setInstallingBrowser] = useState(false);
  const [installBrowserError, setInstallBrowserError] = useState<string | null>(null);
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
    if (!active) {
      return;
    }
    let canceled = false;
    void loadBrowserState(sessionId, t("browserPreviewInvalidResponse"))
      .then((next) => {
        if (canceled || next === null) {
          return;
        }
        applySnapshot(next, { preserveLocalStale: true });
        if (!userLiveNavigationStartedRef.current) {
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
        setError(t("browserPreviewOpenError", { error: message }));
      });
    return () => {
      canceled = true;
    };
  }, [active, sessionId, t]);

  useEffect(() => {
    if (!active || typeof EventSource === "undefined") {
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
        void loadBrowserState(sessionId, t("browserPreviewInvalidResponse"))
          .then((next) => {
            if (alive && next) {
              applySnapshot(next, { preserveLocalStale: true });
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
  }, [active, sessionId]);

  const markMirrorDirty = async (reason: string, dirtyUrl?: string) => {
    const blocked = reason.toLowerCase().includes("cross-origin") || reason.toLowerCase().includes("storage blocked");
    setMirrorStatus(blocked ? "blocked" : "dirty");
    try {
      const body = dirtyUrl ? { sessionId, reason, url: dirtyUrl } : { sessionId, reason };
      const next = await postBrowserSnapshot("/api/browser/dirty", body, t("browserPreviewInvalidResponse"));
      applySnapshot(next);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setMirrorStatus("error");
      setError(t("browserPreviewOpenError", { error: message }));
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
      if (syncRequest.blockedReason) {
        void markMirrorDirty(syncRequest.blockedReason, syncRequest.request.url);
      }
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
      void markMirrorDirty("cross-origin iframe", liveUrlRef.current ?? undefined);
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
      void markMirrorDirty("cross-origin iframe", liveUrlRef.current ?? undefined);
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
              {activityEvents.length > 0 && (
                <Box
                  data-testid="browser-preview-activity"
                  aria-label={t("browserPreviewActivityLabel")}
                  sx={{
                    position: "absolute",
                    right: 10,
                    bottom: 10,
                    zIndex: 3,
                    width: "min(380px, calc(100% - 20px))",
                    maxHeight: 150,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.5,
                    p: 0.75,
                    borderRadius: 1,
                    border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                    backgroundColor: (theme) => theme.custom.surfaces.s2,
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.14)",
                    pointerEvents: "none",
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: (theme) => theme.custom.fonts.mono,
                      fontSize: "0.66rem",
                      fontWeight: 800,
                      color: "text.secondary",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("browserPreviewActivityTitle")}
                  </Typography>
                  {[...activityEvents].reverse().slice(0, 4).map((event) => {
                    const tone = browserEventTone(event.type);
                    return (
                      <Box
                        key={event.id}
                        sx={{
                          minWidth: 0,
                          display: "grid",
                          gridTemplateColumns: "8px minmax(0, 1fr)",
                          alignItems: "baseline",
                          columnGap: 0.75,
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
                              tone === "error"
                                ? theme.palette.status.error.main
                                : tone === "warning"
                                  ? theme.palette.status.running.main
                                  : tone === "success"
                                    ? theme.palette.status.ok.main
                                    : theme.palette.status.info.main,
                          }}
                        />
                        <Typography
                          noWrap
                          title={event.detail ? `${event.label}: ${event.detail}` : event.label}
                          sx={{
                            minWidth: 0,
                            fontFamily: (theme) => theme.custom.fonts.mono,
                            fontSize: "0.72rem",
                            color: "text.primary",
                          }}
                        >
                          {event.label}
                          {event.detail ? (
                            <Box component="span" sx={{ color: "text.secondary" }}>
                              {" · "}
                              {event.detail}
                            </Box>
                          ) : null}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
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
