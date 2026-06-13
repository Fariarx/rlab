import type { BrowserActionTarget, BrowserActivityEvent, BrowserPoint } from "./browser-preview-model";

export function liveFrameDocument(frame: HTMLIFrameElement | null): Document | null {
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

export function replayBrowserActivityEvent(frame: HTMLIFrameElement | null, event: BrowserActivityEvent): boolean {
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

export function isReplayableBrowserActivityEvent(event: BrowserActivityEvent): boolean {
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
