import AdsClickIcon from "@mui/icons-material/AdsClick";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import { Alert, Box, Button, CircularProgress, IconButton, InputBase, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, useToast } from "../ui";

interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

interface BrowserSnapshot {
  readonly sessionId: string;
  readonly activeTabId: string;
  readonly tabs: readonly BrowserTab[];
  readonly latestEvent?: BrowserActivityEvent;
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
  | "action.refresh"
  | "action.scroll"
  | "action.click"
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
}

interface BrowserSyncRequest {
  readonly sessionId: string;
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
    value === "action.refresh" ||
    value === "action.scroll" ||
    value === "action.click" ||
    value === "action.type" ||
    value === "action.press" ||
    value === "action.eval" ||
    value === "action.failed" ||
    value === "console.error" ||
    value === "page.error" ||
    value === "network.failed"
  );
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

function browserSyncRequest(frame: HTMLIFrameElement | null, sessionId: string, targetUrl: string): BrowserSyncRequest {
  if (!frame?.contentWindow) {
    return { sessionId, url: targetUrl };
  }
  try {
    const frameWindow = frame.contentWindow;
    const currentUrl = normalizeBrowserPreviewUrl(frameWindow.location.href);
    if (currentUrl !== targetUrl) {
      return { sessionId, url: targetUrl };
    }
    return {
      sessionId,
      url: currentUrl,
      localStorage: storageToRecord(frameWindow.localStorage),
      sessionStorage: storageToRecord(frameWindow.sessionStorage),
    };
  } catch {
    return { sessionId, url: targetUrl };
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
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const nextPosition = start + text.length;
    input.setSelectionRange(nextPosition, nextPosition);
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
  return true;
}

function isReplayableBrowserActivityEvent(event: BrowserActivityEvent): boolean {
  return event.type === "action.click" || event.type === "action.scroll" || event.type === "action.type" || event.type === "action.press" || event.type === "action.eval";
}

export function BrowserPreview({ sessionId, active, onSendAnnotation, bottomInset = 0 }: BrowserPreviewProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [url, setUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const liveUrlRef = useRef<string | null>(null);
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

  const adoptBrowserUrl = (nextUrl: string) => {
    const normalizedUrl = normalizeBrowserPreviewUrl(nextUrl);
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

  const applySnapshot = (next: BrowserSnapshot) => {
    setSnapshot(next);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
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
        if (canceled || next === null || !next.latestEvent) {
          return;
        }
        applySnapshot(next);
        adoptBrowserUrl(next.url);
        setMirrorStatus("synced");
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
    const source = new EventSource(`/api/browser/events?sessionId=${encodeURIComponent(sessionId)}`);
    setEventStreamStatus("connected");
    const handleBrowserEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const parsed = JSON.parse(message.data) as unknown;
        if (isBrowserActivityEvent(parsed) && parsed.sessionId === sessionId) {
          setActivityEvents((current) => appendBrowserActivityEvent(current, parsed));
          if (isReplayableBrowserActivityEvent(parsed)) {
            setLiveReplayBlocked(!replayBrowserActivityEvent(frameRef.current, parsed));
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
        }
      } catch {
        setEventStreamStatus("error");
      }
    };
    source.addEventListener("browser", handleBrowserEvent);
    source.onerror = () => setEventStreamStatus("error");
    return () => {
      source.removeEventListener("browser", handleBrowserEvent);
      source.close();
    };
  }, [active, sessionId]);

  const syncMirror = async (targetUrl: string) => {
    setMirrorStatus("syncing");
    setError(null);
    try {
      const next = await postBrowserSnapshot("/api/browser/sync", browserSyncRequest(frameRef.current, sessionId, targetUrl), t("browserPreviewInvalidResponse"));
      applySnapshot(next);
      setMirrorStatus("synced");
      setLiveReplayBlocked(false);
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
    setLiveUrl(nextUrl);
    setUrl(nextUrl === browserPreviewDefaultUrl ? "" : nextUrl);
    setFrameKey((current) => current + 1);
    setError(null);
      setMirrorStatus("idle");
      setLiveReplayBlocked(false);
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

  const selectMirrorTab = async (tab: BrowserTab) => {
    try {
      const next = await postBrowserSnapshot(
        "/api/browser/action",
        { sessionId, tabId: tab.id, type: "select-tab" },
        t("browserPreviewInvalidResponse"),
      );
      applySnapshot(next);
      liveUrlRef.current = tab.url;
      setLiveUrl(tab.url);
      setUrl(tab.url === browserPreviewDefaultUrl ? "" : tab.url);
      setFrameHistory((current) => pushFrameHistory(current, tab.url));
      setFrameKey((current) => current + 1);
      setMirrorStatus("synced");
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
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                width: 1,
                height: 12,
                mx: 0.1,
                backgroundColor: (theme) => theme.custom.borders.subtle,
              }}
            />
            <Box component="span" aria-hidden="true" sx={{ color: eventStreamStatus === "error" ? "error.main" : "text.secondary" }}>
              {eventStreamStatus === "connected" ? t("browserPreviewEventsLiveShort") : eventStreamStatus === "error" ? t("browserPreviewEventsErrorShort") : t("browserPreviewEventsIdleShort")}
            </Box>
            <Box component="span" sx={visuallyHiddenSx}>
              {mirrorStatusText}
            </Box>
          </Box>
        </Tooltip>
        {controlTooltip(
          t("browserPreviewOpen"),
          <IconButton data-testid="browser-preview-open-button" aria-label={t("browserPreviewOpen")} type="submit" size="small" disabled={mirrorSyncing}>
            {mirrorSyncing ? <CircularProgress color="inherit" size={18} /> : <OpenInBrowserIcon fontSize="small" />}
          </IconButton>,
        )}
        {liveUrl && (
          controlTooltip(
            t("browserPreviewSyncMirror"),
            <IconButton data-testid="browser-preview-sync-button" aria-label={t("browserPreviewSyncMirror")} size="small" disabled={mirrorSyncing} onClick={() => void syncMirror(liveUrl)}>
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
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.5,
            overflowX: "auto",
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s1,
          }}
        >
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              variant={tab.id === activeTabId ? "contained" : "outlined"}
              size="small"
              onClick={() => void selectMirrorTab(tab)}
              sx={{
                minWidth: 0,
                maxWidth: 220,
                height: 26,
                px: 1,
                textTransform: "none",
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.68rem",
                justifyContent: "flex-start",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {browserTabLabel(tab)}
            </Button>
          ))}
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
