import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserPreview } from "../src/components/workspace/BrowserPreview";
import { renderWithTheme } from "./util/render-with-theme";

function storageFromRecord(items: Record<string, string>): Storage {
  const entries = Object.entries(items);
  return {
    get length() {
      return entries.length;
    },
    clear: vi.fn(),
    getItem: vi.fn((key: string) => items[key] ?? null),
    key: vi.fn((index: number) => entries[index]?.[0] ?? null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };
}

function browserSnapshot(overrides: Partial<{
  readonly sessionId: string;
  readonly activeTabId: string;
  readonly url: string;
  readonly title: string;
  readonly screenshot: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly updatedAt: string;
  readonly tabs: ReadonlyArray<{ readonly id: string; readonly url: string; readonly title: string; readonly active: boolean }>;
  readonly latestEvent: {
    readonly id: number;
    readonly sessionId: string;
    readonly tabId: string;
    readonly type: "action.click";
    readonly label: string;
    readonly detail?: string;
    readonly point?: { readonly x: number; readonly y: number };
    readonly at: string;
  };
}> = {}) {
  const url = overrides.url ?? "about:blank";
  const title = overrides.title ?? "";
  const activeTabId = overrides.activeTabId ?? "tab-1";
  return {
    sessionId: overrides.sessionId ?? "test-session",
    activeTabId,
    tabs: overrides.tabs ?? [{ id: activeTabId, url, title, active: true }],
    url,
    title,
    screenshot: overrides.screenshot ?? "data:image/png;base64,iVBORw0KGgo=",
    viewport: overrides.viewport ?? { width: 800, height: 600 },
    updatedAt: overrides.updatedAt ?? "2026-06-07T09:00:00.000Z",
    ...(overrides.latestEvent ? { latestEvent: overrides.latestEvent } : {}),
  };
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string | URL;
  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string | URL) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emitBrowser(data: unknown): void {
    const event = new MessageEvent("browser", { data: JSON.stringify(data) });
    for (const listener of this.listeners.get("browser") ?? []) {
      listener(event);
    }
  }
}

describe("BrowserPreview", () => {
  it("opens a live iframe immediately while the agent mirror syncs in the background", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/");
    expect(screen.getByText("Зеркало агента синхронизируется...")).toBeInTheDocument();
  });

  it("keeps the live frame inside a compact browser chrome with a 250px minimum surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot()),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    expect(screen.getByLabelText("URL для просмотра")).toHaveValue("");
    expect(screen.getByPlaceholderText("about:blank")).toBe(screen.getByLabelText("URL для просмотра"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(screen.getByTestId("browser-preview-browser-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeInTheDocument();
    fireEvent.mouseOver(screen.getByRole("button", { name: "Аннотация" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Аннотация");
    expect(screen.getByLabelText("Playwright: синхронизировано")).toBeInTheDocument();
    expect(screen.getByTestId("browser-preview-frame-shell")).toHaveStyle({ minHeight: "250px", overflow: "hidden" });
    expect(screen.getByLabelText("URL для просмотра")).toHaveValue("");
    expect(screen.getByLabelText("URL для просмотра").parentElement).toHaveStyle({ height: "30px", maxHeight: "30px" });
    expect(screen.getByTestId("browser-preview-url-input")).toBe(screen.getByLabelText("URL для просмотра"));
    expect(screen.getByTestId("browser-preview-back-button")).toBe(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByTestId("browser-preview-forward-button")).toBe(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByTestId("browser-preview-refresh-button")).toBe(screen.getByRole("button", { name: "Обновить" }));
    expect(screen.getByTestId("browser-preview-open-button")).toBe(screen.getByRole("button", { name: "Открыть" }));
    expect(screen.getByTestId("browser-preview-mode-interact")).toBe(screen.getByRole("button", { name: "Взаимодействие" }));
    expect(screen.getByTestId("browser-preview-mode-annotate")).toBe(screen.getByRole("button", { name: "Аннотация" }));
    expect(screen.getByTestId("browser-preview-mode-component")).toBe(screen.getByRole("button", { name: "Компонент" }));
  });

  it("navigates back and forward inside the iframe history stack without touching the parent page history", async () => {
    const parentBack = vi.spyOn(window.history, "back");
    const parentForward = vi.spyOn(window.history, "forward");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/one" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await screen.findByLabelText("Playwright: синхронизировано");
    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/two" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/two");

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/one");
    expect(parentBack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/two");
    expect(parentForward).not.toHaveBeenCalled();

    parentBack.mockRestore();
    parentForward.mockRestore();
  });

  it("does not send stale iframe storage while opening a different preview URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(browserSnapshot()),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await screen.findByLabelText("Playwright: синхронизировано");
    Object.defineProperty(screen.getByTitle("Живой просмотр страницы"), "contentWindow", {
      configurable: true,
      value: {
        location: { href: "http://localhost:5187/#/old-preview" },
        localStorage: storageFromRecord({ theme: "dark" }),
        sessionStorage: storageFromRecord({ step: "old" }),
      },
    });

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:5187/#/new-preview" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2));
    const postCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(postCalls[1]?.[1]?.body))).toEqual({
      sessionId: "test-session",
      url: "http://localhost:5187/#/new-preview",
    });
  });

  it("renders Playwright tabs and selects a server tab without using parent history", async () => {
    const firstTabs = [
      { id: "tab-1", url: "http://localhost:3000/one", title: "One", active: true },
      { id: "tab-2", url: "http://localhost:3000/two", title: "Two", active: false },
    ];
    const secondTabs = [
      { id: "tab-1", url: "http://localhost:3000/one", title: "One", active: false },
      { id: "tab-2", url: "http://localhost:3000/two", title: "Two", active: true },
    ];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { readonly type?: string };
      if (body.type === "select-tab") {
        return Response.json(browserSnapshot({ activeTabId: "tab-2", url: "http://localhost:3000/two", title: "Two", tabs: secondTabs }));
      }
      return Response.json(browserSnapshot({ activeTabId: "tab-1", url: "http://localhost:3000/one", title: "One", tabs: firstTabs }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/one" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(await screen.findByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));

    await waitFor(() => {
      expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ sessionId: "test-session", tabId: "tab-2", type: "select-tab" });
    });
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/two");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
  });

  it("hydrates existing Playwright tabs even when the bridge snapshot has no latest event", async () => {
    const tabs = [
      { id: "tab-1", url: "http://localhost:3000/one", title: "One", active: false },
      { id: "tab-2", url: "http://localhost:3000/two", title: "Two", active: true },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ activeTabId: "tab-2", url: "http://localhost:3000/two", title: "Two", tabs })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    expect(await screen.findByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/two");
    expect(screen.getByLabelText("URL для просмотра")).toHaveValue("http://localhost:3000/two");
  });

  it("shows live browser activity events and the last agent click marker", async () => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" }))));

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await screen.findByLabelText("Playwright: синхронизировано");

    expect(String(MockEventSource.instances[0]?.url)).toBe("/api/browser/events?sessionId=test-session");
    MockEventSource.instances[0]?.emitBrowser({
      id: 7,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.click",
      label: "Click",
      detail: "x=160 y=120",
      point: { x: 160, y: 120 },
      at: "2026-06-07T09:00:01.000Z",
    });

    expect(await screen.findByTestId("browser-preview-activity")).toHaveTextContent("Click");
    expect(screen.getByTestId("browser-preview-activity")).toHaveTextContent("x=160 y=120");
    expect(screen.getByTestId("browser-preview-action-marker")).toBeInTheDocument();
  });

  it("hydrates existing agent browser state when the preview tab opens", async () => {
    const state = browserSnapshot({
      url: "http://localhost:3000/agent",
      title: "Agent page",
      latestEvent: {
        id: 21,
        sessionId: "test-session",
        tabId: "tab-1",
        type: "action.click",
        label: "Click",
        detail: "x=555 y=222",
        point: { x: 555, y: 222 },
        at: "2026-06-07T12:41:32.174Z",
      },
    });
    const { screenshot: _screenshot, ...bridgeState } = state;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(bridgeState)));

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    expect(await screen.findByTestId("browser-preview-activity")).toHaveTextContent("Click");
    expect(screen.getByTestId("browser-preview-activity")).toHaveTextContent("x=555 y=222");
    expect(screen.getByTestId("browser-preview-action-marker")).toBeInTheDocument();
    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/agent");
    expect(screen.getByLabelText("URL для просмотра")).toHaveValue("http://localhost:3000/agent");
  });

  it("replays live agent click, type, scroll, and eval actions into accessible iframe content", async () => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" }))));

    renderWithTheme(<BrowserPreview sessionId="test-session" active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await screen.findByLabelText("Playwright: синхронизировано");

    const frame = screen.getByTitle("Живой просмотр страницы") as HTMLIFrameElement;
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    expect(frameDocument).not.toBeNull();
    expect(frameWindow).not.toBeNull();
    if (!frameDocument || !frameWindow) {
      throw new Error("iframe document is unavailable");
    }
    frameDocument.open();
    frameDocument.write(`<!doctype html><body><button id="clicker">Click</button><input id="typed" /><iframe id="child-frame"></iframe></body>`);
    frameDocument.close();
    const clicker = frameDocument.querySelector("#clicker");
    const typed = frameDocument.querySelector("#typed") as HTMLInputElement | null;
    const childFrame = frameDocument.querySelector("#child-frame") as HTMLIFrameElement | null;
    const childDocument = childFrame?.contentDocument ?? null;
    if (!clicker || !typed || !childFrame || !childDocument) {
      throw new Error("iframe fixture did not render");
    }
    childDocument.open();
    childDocument.write(`<!doctype html><body><button id="framed-clicker">Framed</button><input id="framed-typed" /></body>`);
    childDocument.close();
    const framedClicker = childDocument.querySelector("#framed-clicker");
    const framedTyped = childDocument.querySelector("#framed-typed") as HTMLInputElement | null;
    if (!framedClicker || !framedTyped) {
      throw new Error("nested iframe fixture did not render");
    }
    let clicks = 0;
    let framedClicks = 0;
    clicker.addEventListener("click", () => {
      clicks += 1;
    });
    framedClicker.addEventListener("click", () => {
      framedClicks += 1;
    });
    frameDocument.elementFromPoint = vi.fn(() => clicker);
    const scrollBy = vi.fn();
    Object.defineProperty(frameWindow, "scrollBy", { configurable: true, value: scrollBy });

    MockEventSource.instances[0]?.emitBrowser({
      id: 8,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.click",
      label: "Click",
      detail: "#clicker",
      target: { selector: "#clicker" },
      at: "2026-06-07T09:00:02.000Z",
    });
    MockEventSource.instances[0]?.emitBrowser({
      id: 9,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.type",
      label: "Type",
      detail: "#typed · ok",
      selector: "#typed",
      text: "ok",
      at: "2026-06-07T09:00:03.000Z",
    });
    MockEventSource.instances[0]?.emitBrowser({
      id: 10,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.scroll",
      label: "Scroll",
      detail: "deltaY=450",
      deltaY: 450,
      at: "2026-06-07T09:00:04.000Z",
    });
    MockEventSource.instances[0]?.emitBrowser({
      id: 11,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.eval",
      label: "Eval",
      detail: "document.body.dataset.agentEval = \"done\"",
      script: "document.body.dataset.agentEval = \"done\"",
      at: "2026-06-07T09:00:05.000Z",
    });
    MockEventSource.instances[0]?.emitBrowser({
      id: 12,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.click",
      label: "Click",
      detail: "#framed-clicker",
      target: { framePath: ["#child-frame"], selector: "#framed-clicker" },
      at: "2026-06-07T09:00:06.000Z",
    });
    MockEventSource.instances[0]?.emitBrowser({
      id: 13,
      sessionId: "test-session",
      tabId: "tab-1",
      type: "action.type",
      label: "Type",
      detail: "#framed-typed · nested",
      target: { framePath: ["#child-frame"], selector: "#framed-typed" },
      text: "nested",
      at: "2026-06-07T09:00:07.000Z",
    });

    await waitFor(() => expect(clicks).toBe(1));
    await waitFor(() => expect(framedClicks).toBe(1));
    expect(typed.value).toBe("ok");
    expect(framedTyped.value).toBe("nested");
    expect(scrollBy).toHaveBeenCalledWith({ top: 450, left: 0, behavior: "auto" });
    expect(frameDocument.body.dataset.agentEval).toBe("done");
  });

  it("sends viewport annotations from the live iframe surface to the agent", async () => {
    const onSendAnnotation = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active onSendAnnotation={onSendAnnotation} />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(await screen.findByText("Зеркало агента синхронизировано")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Аннотация" }));
    const canvas = screen.getByTestId("browser-preview-canvas");
    canvas.getBoundingClientRect = () => ({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
      top: 0,
      width: 800,
      x: 0,
      y: 0,
    });

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 260, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.change(screen.getByLabelText("Комментарий к области"), { target: { value: "Проверь CTA" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(onSendAnnotation).toHaveBeenCalledTimes(1));
    expect(onSendAnnotation.mock.calls[0][0]).toContain("Проверь CTA");
    expect(onSendAnnotation.mock.calls[0][0]).toContain("rect: x=100 y=120 width=200 height=140");
  });

  it("shows compact annotation controls only after drag commit and anchors them below a top selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active onSendAnnotation={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(await screen.findByLabelText("Playwright: синхронизировано")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Аннотация" }));
    const canvas = screen.getByTestId("browser-preview-canvas");
    canvas.getBoundingClientRect = () => ({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
      top: 0,
      width: 800,
      x: 0,
      y: 0,
    });

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 40, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 260, clientY: 80, pointerId: 2 });
    expect(screen.queryByTestId("browser-preview-annotation-panel")).not.toBeInTheDocument();

    fireEvent.pointerUp(canvas, { pointerId: 2 });

    expect(screen.getByTestId("browser-preview-annotation-panel")).toHaveAttribute("data-placement", "below");
    expect(screen.getByTestId("browser-preview-selection-label")).toHaveTextContent("Область");
    expect(screen.getByRole("button", { name: "Отправить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сброс" })).toBeInTheDocument();
  });

  it("keeps pointer capture without forcing a custom cursor while drawing an annotation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active onSendAnnotation={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(await screen.findByLabelText("Playwright: синхронизировано")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Аннотация" }));
    const canvas = screen.getByTestId("browser-preview-canvas");
    const setPointerCapture = vi.fn();
    Object.assign(canvas, { setPointerCapture });
    canvas.getBoundingClientRect = () => ({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
      top: 0,
      width: 800,
      x: 0,
      y: 0,
    });

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 40, pointerId: 7 });
    fireEvent.pointerMove(canvas, { clientX: 260, clientY: 80, pointerId: 7 });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(screen.getByTestId("browser-preview-frame-shell")).not.toHaveStyle({ cursor: "crosshair" });
    expect(canvas).not.toHaveStyle({ cursor: "crosshair" });
    expect(screen.getByTestId("browser-preview-selection-frame")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("browser-preview-selection-frame")).not.toHaveStyle({ cursor: "crosshair" });
  });

  it("clears the current selection when switching annotation modes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active onSendAnnotation={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(await screen.findByLabelText("Playwright: синхронизировано")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Аннотация" }));
    const canvas = screen.getByTestId("browser-preview-canvas");
    canvas.getBoundingClientRect = () => ({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
      top: 0,
      width: 800,
      x: 0,
      y: 0,
    });

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 120, pointerId: 3 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 260, pointerId: 3 });
    fireEvent.pointerUp(canvas, { pointerId: 3 });
    expect(screen.getByTestId("browser-preview-annotation-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Компонент" }));

    expect(screen.queryByTestId("browser-preview-annotation-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-preview-component-canvas")).toBeInTheDocument();
  });

  it("sends picked page component details from the live iframe to the agent", async () => {
    const onSendAnnotation = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(browserSnapshot({ url: "http://localhost:3000/", title: "Local app" })),
      ),
    );

    renderWithTheme(<BrowserPreview sessionId="test-session" active onSendAnnotation={onSendAnnotation} />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(await screen.findByLabelText("Playwright: синхронизировано")).toBeInTheDocument();

    const pickedElement = document.createElement("button");
    pickedElement.id = "save";
    pickedElement.className = "primary wide";
    pickedElement.setAttribute("data-testid", "save-button");
    pickedElement.textContent = "Save changes";
    pickedElement.getBoundingClientRect = () => ({
      bottom: 148,
      height: 48,
      left: 120,
      right: 360,
      toJSON: () => ({}),
      top: 100,
      width: 240,
      x: 120,
      y: 100,
    });
    Object.defineProperty(screen.getByTitle("Живой просмотр страницы"), "contentWindow", {
      configurable: true,
      value: {
        document: { elementFromPoint: vi.fn(() => pickedElement) },
        innerWidth: 800,
        innerHeight: 600,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Компонент" }));
    const canvas = screen.getByTestId("browser-preview-component-canvas");
    canvas.getBoundingClientRect = () => ({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
      top: 0,
      width: 800,
      x: 0,
      y: 0,
    });

    fireEvent.click(canvas, { clientX: 160, clientY: 120 });

    expect(screen.getByText("button#save.primary.wide")).toBeInTheDocument();
    expect(screen.getByTestId("browser-preview-selection-label")).toHaveTextContent("button#save.primary.wide");
    expect(screen.getByTestId("browser-preview-frame-shell")).not.toHaveStyle({ cursor: "cell" });
    expect(canvas).not.toHaveStyle({ cursor: "cell" });
    expect(screen.getByTestId("browser-preview-component-frame")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("browser-preview-component-frame")).not.toHaveStyle({ cursor: "cell" });
    expect(screen.getByText("Save changes")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Комментарий к области"), { target: { value: "Проверь кнопку" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(onSendAnnotation).toHaveBeenCalledTimes(1));
    expect(onSendAnnotation.mock.calls[0][0]).toContain("Browser component annotation");
    expect(onSendAnnotation.mock.calls[0][0]).toContain("component: button#save.primary.wide");
    expect(onSendAnnotation.mock.calls[0][0]).toContain('selector: [data-testid="save-button"]');
    expect(onSendAnnotation.mock.calls[0][0]).toContain("text: Save changes");
    expect(onSendAnnotation.mock.calls[0][0]).toContain("rect: x=120 y=100 width=240 height=48");
    expect(onSendAnnotation.mock.calls[0][0]).toContain("Проверь кнопку");
  });
});
