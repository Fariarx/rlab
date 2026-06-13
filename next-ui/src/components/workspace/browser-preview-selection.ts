import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { clamp, type BrowserComponentSelection, type BrowserPoint, type BrowserSelectionRect, type BrowserViewport } from "./browser-preview-model";

export const annotationPanelGap = 8;
export const annotationPanelEstimatedHeight = 132;
export const annotationPanelWidthCss = "min(520px, calc(100% - 16px))";
export const annotationPanelHeightCss = "min(132px, calc(100% - 16px))";

export function pointFromPointerEvent(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, viewport: BrowserViewport): BrowserPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  const width = bounds.width || 1;
  const height = bounds.height || 1;
  return {
    x: clamp(Math.round(((event.clientX - bounds.left) / width) * viewport.width), 0, viewport.width),
    y: clamp(Math.round(((event.clientY - bounds.top) / height) * viewport.height), 0, viewport.height),
  };
}

export function selectionRectBetween(start: BrowserPoint, end: BrowserPoint): BrowserSelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function rectSx(rect: BrowserSelectionRect, viewport: BrowserViewport) {
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

export function annotationPanelSx(rect: BrowserSelectionRect, viewport: BrowserViewport) {
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

function optionalClippedAttribute(value: string | null | undefined): string | undefined {
  const text = clippedText(value ?? "");
  return text.length > 0 ? text : undefined;
}

function optionalElementValue(element: Element): string | undefined {
  const view = element.ownerDocument.defaultView ?? window;
  if (element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement || element instanceof view.HTMLSelectElement) {
    return optionalClippedAttribute(element.value);
  }
  return undefined;
}

function optionalElementPlaceholder(element: Element): string | undefined {
  const view = element.ownerDocument.defaultView ?? window;
  if (element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement) {
    return optionalClippedAttribute(element.placeholder);
  }
  return undefined;
}

function optionalElementChecked(element: Element): boolean | undefined {
  const view = element.ownerDocument.defaultView ?? window;
  if (element instanceof view.HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    return element.checked;
  }
  return undefined;
}

function optionalElementDisabled(element: Element): boolean | undefined {
  const view = element.ownerDocument.defaultView ?? window;
  if (element instanceof view.HTMLButtonElement || element instanceof view.HTMLInputElement || element instanceof view.HTMLSelectElement || element instanceof view.HTMLTextAreaElement) {
    return element.disabled;
  }
  if (element.getAttribute("aria-disabled") === "true") {
    return true;
  }
  return undefined;
}

export function cropComponentScreenshot(dataUrl: string | undefined, rect: BrowserSelectionRect, viewport: BrowserViewport): Promise<string | undefined> {
  if (!dataUrl || rect.width < 1 || rect.height < 1 || viewport.width < 1 || viewport.height < 1) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scaleX = image.naturalWidth / viewport.width;
        const scaleY = image.naturalHeight / viewport.height;
        const padding = 8;
        const sourceX = Math.max(0, Math.floor((rect.x - padding) * scaleX));
        const sourceY = Math.max(0, Math.floor((rect.y - padding) * scaleY));
        const sourceRight = Math.min(image.naturalWidth, Math.ceil((rect.x + rect.width + padding) * scaleX));
        const sourceBottom = Math.min(image.naturalHeight, Math.ceil((rect.y + rect.height + padding) * scaleY));
        const width = Math.max(1, sourceRight - sourceX);
        const height = Math.max(1, sourceBottom - sourceY);
        const maxOutput = 480;
        const outputScale = Math.min(1, maxOutput / Math.max(width, height));
        const outputWidth = Math.max(1, Math.round(width * outputScale));
        const outputHeight = Math.max(1, Math.round(height * outputScale));
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(undefined);
          return;
        }
        context.drawImage(image, sourceX, sourceY, width, height, 0, 0, outputWidth, outputHeight);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}

export function pickBrowserComponent(frame: HTMLIFrameElement | null, event: ReactMouseEvent<HTMLElement>): BrowserComponentSelection {
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
    tagName: element.tagName.toLowerCase(),
    role: optionalClippedAttribute(element.getAttribute("role")),
    ariaLabel: optionalClippedAttribute(element.getAttribute("aria-label")),
    testId: optionalClippedAttribute(element.getAttribute("data-testid") ?? element.getAttribute("data-test")),
    name: optionalClippedAttribute(element.getAttribute("name")),
    title: optionalClippedAttribute(element.getAttribute("title")),
    href: element instanceof (element.ownerDocument.defaultView ?? window).HTMLAnchorElement ? optionalClippedAttribute(element.href) : undefined,
    value: optionalElementValue(element),
    placeholder: optionalElementPlaceholder(element),
    checked: optionalElementChecked(element),
    disabled: optionalElementDisabled(element),
    classes: elementClassNames(element),
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

export function buildAnnotationMessage(target: { readonly url: string; readonly title: string }, rect: BrowserSelectionRect, comment: string): string {
  return [
    "Browser annotation",
    `url: ${target.url}`,
    `title: ${target.title || "-"}`,
    `rect: x=${rect.x} y=${rect.y} width=${rect.width} height=${rect.height}`,
    `comment: ${comment.trim()}`,
  ].join("\n");
}

export function buildComponentAnnotationMessage(target: { readonly url: string; readonly title: string }, component: BrowserComponentSelection, comment: string): string {
  const lines = [
    "Source: rlab Preview plugin / Component picker",
    "Browser component annotation",
    `url: ${target.url}`,
    `title: ${target.title || "-"}`,
    `component: ${component.label}`,
    `selector: ${component.selector}`,
    `tag: ${component.tagName}`,
    `classes: ${component.classes.length > 0 ? component.classes.join(" ") : "-"}`,
    `role: ${component.role ?? "-"}`,
    `aria-label: ${component.ariaLabel ?? "-"}`,
    `test-id: ${component.testId ?? "-"}`,
    `name: ${component.name ?? "-"}`,
    `element-title: ${component.title ?? "-"}`,
    `href: ${component.href ?? "-"}`,
    `value: ${component.value ?? "-"}`,
    `placeholder: ${component.placeholder ?? "-"}`,
    `checked: ${component.checked === undefined ? "-" : String(component.checked)}`,
    `disabled: ${component.disabled === undefined ? "-" : String(component.disabled)}`,
    `text: ${component.text || "-"}`,
    `rect: x=${component.rect.x} y=${component.rect.y} width=${component.rect.width} height=${component.rect.height}`,
    `viewport: width=${component.viewport.width} height=${component.viewport.height}`,
    "agent-note: This metadata and optional screenshot were captured by rlab's Preview tab component picker, not typed by the user or scraped from page text.",
    `componentScreenshotStatus: ${component.screenshotDataUrl ? "attached" : "unavailable"}`,
    `componentScreenshotDataUrl: ${component.screenshotDataUrl ?? "-"}`,
    `comment: ${comment.trim()}`,
  ];
  return lines.join("\n");
}
