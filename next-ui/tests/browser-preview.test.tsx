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

describe("BrowserPreview", () => {
  it("opens a live iframe immediately while the agent mirror syncs in the background", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    renderWithTheme(<BrowserPreview active />);

    fireEvent.change(screen.getByLabelText("URL для просмотра"), { target: { value: "http://localhost:3000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(screen.getByTitle("Живой просмотр страницы")).toHaveAttribute("src", "http://localhost:3000/");
    expect(screen.getByText("Зеркало агента синхронизируется...")).toBeInTheDocument();
  });

  it("keeps the live frame inside a compact browser chrome with a 250px minimum surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          sessionId: "browser-default",
          url: "about:blank",
          title: "",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active />);

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
  });

  it("navigates back and forward inside the iframe history stack without touching the parent page history", async () => {
    const parentBack = vi.spyOn(window.history, "back");
    const parentForward = vi.spyOn(window.history, "forward");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active />);

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
      Response.json({
        sessionId: "browser-default",
        url: "about:blank",
        title: "",
        screenshot: "data:image/png;base64,iVBORw0KGgo=",
        viewport: { width: 800, height: 600 },
        updatedAt: "2026-06-07T09:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<BrowserPreview active />);

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ url: "http://localhost:5187/#/new-preview" });
  });

  it("sends viewport annotations from the live iframe surface to the agent", async () => {
    const onSendAnnotation = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active onSendAnnotation={onSendAnnotation} />);

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
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active onSendAnnotation={vi.fn()} />);

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
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active onSendAnnotation={vi.fn()} />);

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
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active onSendAnnotation={vi.fn()} />);

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
        Response.json({
          sessionId: "browser-default",
          url: "http://localhost:3000/",
          title: "Local app",
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          viewport: { width: 800, height: 600 },
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
      ),
    );

    renderWithTheme(<BrowserPreview active onSendAnnotation={onSendAnnotation} />);

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
