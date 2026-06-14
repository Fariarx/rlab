export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

export type BrowserPreviewFreshness = "synced" | "dirty" | "blocked" | "syncing" | "error";

export interface BrowserSnapshot {
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

export interface BrowserTab {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

export type BrowserActivityEventType =
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

export interface BrowserActionFrameTarget {
  readonly framePath?: readonly string[];
}

export type BrowserActionTarget =
  | (BrowserActionFrameTarget & { readonly selector: string })
  | (BrowserActionFrameTarget & { readonly role: string; readonly name?: string })
  | (BrowserActionFrameTarget & { readonly text: string })
  | (BrowserActionFrameTarget & { readonly label: string });

export interface BrowserActivityEvent {
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

export interface BrowserPoint {
  readonly x: number;
  readonly y: number;
}

export interface BrowserSelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserComponentSelection {
  readonly label: string;
  readonly selector: string;
  readonly tagName: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly testId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly href?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly classes: readonly string[];
  readonly text: string;
  readonly rect: BrowserSelectionRect;
  readonly viewport: BrowserViewport;
  readonly screenshotDataUrl?: string;
}

export interface BrowserSelectionPanel {
  readonly kind: "region" | "component";
  readonly label: string;
  readonly description: string;
  readonly rect: BrowserSelectionRect;
  readonly viewport: BrowserViewport;
}

export interface BrowserPreviewAnnotationState {
  readonly selectionReady: boolean;
  readonly committedSelectionReady: boolean;
  readonly componentReady: boolean;
  readonly canSendAnnotation: boolean;
  readonly canSendComponent: boolean;
  readonly panel: BrowserSelectionPanel | null;
}

export interface BrowserPreviewAnnotationStateInput {
  readonly liveUrl: string | null;
  readonly selection: BrowserSelectionRect | null;
  readonly dragStart: BrowserPoint | null;
  readonly componentSelection: BrowserComponentSelection | null;
  readonly viewport: BrowserViewport | undefined;
  readonly comment: string;
  readonly canSend: boolean;
  readonly regionLabel: string;
  readonly regionDescription: string;
}

export interface BrowserPreviewStatusLabelKeys {
  readonly mirrorStatusKey:
    | "browserPreviewMirrorSyncing"
    | "browserPreviewMirrorSynced"
    | "browserPreviewMirrorDirty"
    | "browserPreviewMirrorCrossOrigin"
    | "browserPreviewMirrorBlocked"
    | "browserPreviewMirrorError"
    | "browserPreviewLiveOnly";
  readonly playwrightStatusKey:
    | "browserPreviewPlaywrightStatusSyncing"
    | "browserPreviewPlaywrightStatusSynced"
    | "browserPreviewPlaywrightStatusDirty"
    | "browserPreviewPlaywrightStatusCrossOrigin"
    | "browserPreviewPlaywrightStatusBlocked"
    | "browserPreviewPlaywrightStatusError"
    | "browserPreviewPlaywrightStatusIdle";
  readonly crossOriginBlocked: boolean;
}

export interface BrowserActivityEventEffects {
  readonly navigationUrl: string | null;
  readonly resetReplayBlocked: boolean;
  readonly refreshTabs: boolean;
  readonly snapshotPatch: Partial<Pick<BrowserSnapshot, "title" | "url">> | null;
}

export interface BrowserPreviewSnapshotApplication {
  readonly activeTabId: string;
  readonly latestEvent: BrowserActivityEvent | null;
  readonly mirrorStatus: MirrorStatus;
  readonly snapshot: BrowserSnapshot;
  readonly tabs: readonly BrowserTab[];
}

export interface BrowserPreviewProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly bridgeActive?: boolean;
  readonly onSendAnnotation?: (message: string) => void;
  readonly onActivityEventsChange?: (events: readonly BrowserActivityEvent[]) => void;
  readonly bottomInset?: number;
  /** External request to open a URL (e.g. from a chat link's "open in preview").
   *  The nonce changes per request so re-opening the same URL re-triggers. */
  readonly openRequest?: { readonly url: string; readonly nonce: number };
  /** Optional host[:port] to rewrite loopback dev URLs to (Settings override).
   *  Empty ⇒ route loopback URLs through rlab's same-origin proxy instead. */
  readonly serverHostOverride?: string;
}

export interface BrowserSyncRequest {
  readonly sessionId: string;
  readonly url: string;
  readonly localStorage?: Record<string, string>;
  readonly sessionStorage?: Record<string, string>;
}

export interface BrowserSyncRequestResult {
  readonly request: BrowserSyncRequest;
  readonly blockedReason?: string;
}

export interface FrameHistoryState {
  readonly entries: readonly string[];
  readonly index: number;
}

export type PreviewMode = "interact" | "annotate" | "component";
export type MirrorStatus = "idle" | BrowserPreviewFreshness;
export type EventStreamStatus = "idle" | "connected" | "error";
export const browserPreviewDefaultUrl = "about:blank";

export type BrowserPreviewStatusTone = "running" | "ok" | "warn" | "error" | "idle";

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function isBrowserActivityEvent(value: unknown): value is BrowserActivityEvent {
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

export function isBrowserSnapshot(value: unknown): value is BrowserSnapshot {
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

export function storageToRecord(storage: Storage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) {
      result[key] = storage.getItem(key) ?? "";
    }
  }
  return result;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeBrowserPreviewUrl(value: string): string {
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
export function resolvePreviewFrameUrl(rawUrl: string, serverHostOverride: string): string {
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
export function resolvePreviewMirrorUrl(frameUrl: string): string {
  const proxyMatch = /\/preview-proxy\/(\d{1,5})(\/.*)?$/.exec(frameUrl);
  if (proxyMatch && typeof window !== "undefined" && frameUrl.startsWith(window.location.origin)) {
    return `http://127.0.0.1:${proxyMatch[1]}${proxyMatch[2] ?? "/"}`;
  }
  return frameUrl;
}

export function pushFrameHistory(current: FrameHistoryState, nextUrl: string): FrameHistoryState {
  if (current.entries[current.index] === nextUrl) {
    return current;
  }
  const retainedEntries = current.index >= 0 ? current.entries.slice(0, current.index + 1) : [];
  return { entries: [...retainedEntries, nextUrl], index: retainedEntries.length };
}

export function viewportFromElement(element: HTMLElement, snapshotViewport: BrowserViewport | undefined): BrowserViewport {
  if (snapshotViewport) {
    return snapshotViewport;
  }
  const bounds = element.getBoundingClientRect();
  return { width: Math.max(Math.round(bounds.width), 1), height: Math.max(Math.round(bounds.height), 1) };
}

export function readableFrameUrl(frame: HTMLIFrameElement | null): string | null {
  if (!frame?.contentWindow) {
    return null;
  }
  try {
    return normalizeBrowserPreviewUrl(frame.contentWindow.location.href);
  } catch {
    return null;
  }
}

export function browserSyncRequest(frame: HTMLIFrameElement | null, sessionId: string, targetUrl: string): BrowserSyncRequestResult {
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

export function appendBrowserActivityEvent(events: readonly BrowserActivityEvent[], event: BrowserActivityEvent): readonly BrowserActivityEvent[] {
  const withoutDuplicate = events.filter((item) => item.id !== event.id);
  return [...withoutDuplicate, event].sort((a, b) => a.id - b.id).slice(-8);
}

export function browserActivityEventEffects(event: BrowserActivityEvent): BrowserActivityEventEffects {
  const navigationUrl =
    event.url && (event.type === "navigation.started" || event.type === "navigation.done" || event.type === "tab.selected")
      ? event.url
      : null;
  const snapshotPatch = event.url || event.title ? { ...(event.url ? { url: event.url } : {}), ...(event.title ? { title: event.title } : {}) } : null;
  return {
    navigationUrl,
    resetReplayBlocked: navigationUrl !== null,
    refreshTabs: event.type === "tab.created" || event.type === "tab.closed" || event.type === "tab.selected",
    snapshotPatch,
  };
}

export function browserPreviewSnapshotApplication(
  currentMirrorStatus: MirrorStatus,
  snapshot: BrowserSnapshot,
  options?: { readonly preserveLocalStale?: boolean },
): BrowserPreviewSnapshotApplication {
  const preserveLocalStale = options?.preserveLocalStale === true && snapshot.freshness === "synced" && (currentMirrorStatus === "dirty" || currentMirrorStatus === "blocked");
  return {
    activeTabId: snapshot.activeTabId,
    latestEvent: snapshot.latestEvent ?? null,
    mirrorStatus: preserveLocalStale ? currentMirrorStatus : snapshot.freshness,
    snapshot,
    tabs: snapshot.tabs,
  };
}

export function browserTabLabel(tab: BrowserTab): string {
  if (tab.title.trim()) {
    return tab.title.trim();
  }
  if (tab.url === browserPreviewDefaultUrl) {
    return browserPreviewDefaultUrl;
  }
  try {
    return new URL(tab.url).host;
  } catch {
    return tab.url;
  }
}

export function browserTabHost(url: string): string {
  if (!url || url === browserPreviewDefaultUrl) {
    return "";
  }
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function mirrorStatusDotStatus(status: MirrorStatus): BrowserPreviewStatusTone {
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

export function mirrorStatusDotPulse(status: MirrorStatus): boolean {
  return status === "syncing" || status === "dirty" || status === "blocked" || status === "error";
}

export function browserPreviewStatusLabelKeys(status: MirrorStatus, freshnessReason: string | undefined): BrowserPreviewStatusLabelKeys {
  const crossOriginBlocked = status === "blocked" && freshnessReason?.toLowerCase().includes("cross-origin") === true;
  switch (status) {
    case "syncing":
      return { mirrorStatusKey: "browserPreviewMirrorSyncing", playwrightStatusKey: "browserPreviewPlaywrightStatusSyncing", crossOriginBlocked };
    case "synced":
      return { mirrorStatusKey: "browserPreviewMirrorSynced", playwrightStatusKey: "browserPreviewPlaywrightStatusSynced", crossOriginBlocked };
    case "dirty":
      return { mirrorStatusKey: "browserPreviewMirrorDirty", playwrightStatusKey: "browserPreviewPlaywrightStatusDirty", crossOriginBlocked };
    case "blocked":
      return crossOriginBlocked
        ? { mirrorStatusKey: "browserPreviewMirrorCrossOrigin", playwrightStatusKey: "browserPreviewPlaywrightStatusCrossOrigin", crossOriginBlocked }
        : { mirrorStatusKey: "browserPreviewMirrorBlocked", playwrightStatusKey: "browserPreviewPlaywrightStatusBlocked", crossOriginBlocked };
    case "error":
      return { mirrorStatusKey: "browserPreviewMirrorError", playwrightStatusKey: "browserPreviewPlaywrightStatusError", crossOriginBlocked };
    case "idle":
      return { mirrorStatusKey: "browserPreviewLiveOnly", playwrightStatusKey: "browserPreviewPlaywrightStatusIdle", crossOriginBlocked };
  }
}

export function createBrowserPreviewAnnotationState({
  liveUrl,
  selection,
  dragStart,
  componentSelection,
  viewport,
  comment,
  canSend,
  regionLabel,
  regionDescription,
}: BrowserPreviewAnnotationStateInput): BrowserPreviewAnnotationState {
  const selectionReady = liveUrl !== null && selection !== null && selection.width >= 4 && selection.height >= 4;
  const committedSelectionReady = selectionReady && dragStart === null;
  const componentReady = liveUrl !== null && componentSelection !== null;
  const commentReady = comment.trim().length > 0 && canSend;
  const panel =
    componentSelection !== null
      ? {
          kind: "component" as const,
          label: componentSelection.label,
          description: componentSelection.text || componentSelection.selector,
          rect: componentSelection.rect,
          viewport: componentSelection.viewport,
        }
      : committedSelectionReady && selection !== null && viewport !== undefined
        ? {
            kind: "region" as const,
            label: regionLabel,
            description: regionDescription,
            rect: selection,
            viewport,
          }
        : null;
  return {
    selectionReady,
    committedSelectionReady,
    componentReady,
    canSendAnnotation: committedSelectionReady && commentReady,
    canSendComponent: componentReady && commentReady,
    panel,
  };
}
