import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const terminalMock = vi.hoisted(() => {
  class FakeTerminal {
    static readonly instances: FakeTerminal[] = [];
    readonly handlers: Array<(data: string) => void> = [];
    cols = 80;
    rows = 24;
    private host: HTMLElement | null = null;

    constructor() {
      FakeTerminal.instances.push(this);
    }

    loadAddon(): void {}

    open(host: HTMLElement): void {
      this.host = host;
    }

    onData(handler: (data: string) => void): void {
      this.handlers.push(handler);
    }

    write(data: string | Uint8Array, callback?: () => void): void {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (this.host) {
        this.host.textContent = `${this.host.textContent ?? ""}${text}`;
      }
      callback?.();
    }

    resize(cols: number, rows: number): void {
      this.cols = cols;
      this.rows = rows;
    }

    reset(): void {
      if (this.host) {
        this.host.textContent = "";
      }
    }

    focus(): void {}

    dispose(): void {}

    emitInput(data: string): void {
      for (const handler of this.handlers) {
        handler(data);
      }
    }
  }

  class FakeFitAddon {
    fit(): void {}
  }

  return { FakeFitAddon, FakeTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: terminalMock.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: terminalMock.FakeFitAddon }));

import { TerminalView } from "../src/components/workspace/TerminalView";
import { renderWithTheme } from "./util/render-with-theme";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly sent: Array<string | Uint8Array> = [];
  binaryType = "";
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data: string | ArrayBuffer): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function socketFor(path: string): FakeWebSocket {
  const socket = FakeWebSocket.instances.find((candidate) => candidate.url.includes(path));
  if (!socket) {
    throw new Error(`Missing socket ${path}`);
  }
  return socket;
}

function socketsFor(path: string): FakeWebSocket[] {
  return FakeWebSocket.instances.filter((candidate) => candidate.url.includes(path));
}

describe("TerminalView", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeWebSocket.instances = [];
    terminalMock.FakeTerminal.instances.length = 0;
  });

  it("creates a PTY session and restores terminal state over WebSocket", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      if (path === "/api/terminal" && init?.method === "POST") {
        return Response.json({ id: "term-1", pid: 1234 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab" />);

    const output = screen.getByRole("log", { name: "Вывод терминала" });
    expect(output).toHaveAttribute("aria-busy", "true");
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/terminal",
        expect.objectContaining({
          method: "POST",
          headers: {
            "X-Rlab-Terminal-Cwd": "/root/workspace/rlab",
            "X-Rlab-Terminal-Cols": "80",
            "X-Rlab-Terminal-Rows": "24",
            "X-Rlab-Terminal-Pixel-Width": "640",
            "X-Rlab-Terminal-Pixel-Height": "360",
          },
        }),
      ),
    );

    const control = socketFor("/api/terminal/control");
    const io = socketFor("/api/terminal/io");
    control.open();
    io.open();
    control.message(JSON.stringify({ type: "restore", snapshot: "restored\n", cols: 90, rows: 30 }));

    expect(await screen.findByText("restored")).toBeInTheDocument();
    expect(control.sent).toContain(JSON.stringify({ type: "restore_complete" }));
    expect(output).toHaveAttribute("aria-busy", "false");
  });

  it("sends xterm input to the io socket and stops through control plus DELETE", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      if (path === "/api/terminal" && init?.method === "POST") {
        return Response.json({ id: "term-1", pid: 1234 });
      }
      if (path === "/api/terminal?id=term-1" && init?.method === "DELETE") {
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab-second" />);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const control = socketFor("/api/terminal/control");
    const io = socketFor("/api/terminal/io");
    control.open();
    io.open();

    terminalMock.FakeTerminal.instances[0]?.emitInput("pwd\r");
    expect(io.sent).toContain("pwd\r");

    fireEvent.click(await screen.findByRole("button", { name: "Остановить команду" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/terminal?id=term-1", expect.objectContaining({ method: "DELETE" })));
    expect(control.sent).toContain(JSON.stringify({ type: "stop" }));
  });

  it("can restart a terminal after the user stops the session", async () => {
    let createCount = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      if (path === "/api/terminal" && init?.method === "POST") {
        createCount += 1;
        return Response.json({ id: `term-${createCount}`, pid: 1234 + createCount });
      }
      if (path.startsWith("/api/terminal?id=term-") && init?.method === "DELETE") {
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab-restart" />);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    socketFor("/api/terminal/control").open();
    socketFor("/api/terminal/io").open();

    fireEvent.click(await screen.findByRole("button", { name: "Остановить команду" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Перезапустить терминал" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Перезапустить терминал" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/terminal",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Rlab-Terminal-Cwd": "/root/workspace/rlab-restart",
            "X-Rlab-Terminal-Cols": "80",
            "X-Rlab-Terminal-Rows": "24",
          }),
        }),
      ),
    );
    await waitFor(() => expect(createCount).toBe(2));
    expect(FakeWebSocket.instances.length).toBe(4);
  });

  it("reconnects the terminal websocket once when the connection is lost", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      if (path === "/api/terminal" && init?.method === "POST") {
        return Response.json({ id: "term-1", pid: 1234 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab-reconnect" />);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const control = socketFor("/api/terminal/control");
    const io = socketFor("/api/terminal/io");
    control.open();
    io.open();
    control.message(JSON.stringify({ type: "restore", snapshot: "before\n", cols: 80, rows: 24 }));
    expect(await screen.findByText("before")).toBeInTheDocument();

    control.close();

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(4));
    const reconnectedControl = socketsFor("/api/terminal/control")[1];
    const reconnectedIo = socketsFor("/api/terminal/io")[1];
    expect(reconnectedControl?.url).toContain("id=term-1");
    expect(reconnectedIo?.url).toContain("id=term-1");
    expect(fetch).toHaveBeenCalledTimes(1);

    reconnectedControl?.open();
    reconnectedIo?.open();
    reconnectedControl?.message(JSON.stringify({ type: "restore", snapshot: "after\n", cols: 80, rows: 24 }));

    expect(await screen.findByText("after")).toBeInTheDocument();
    expect(reconnectedControl?.sent).toContain(JSON.stringify({ type: "restore_complete" }));
  });

  it("sends mobile terminal key controls", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      if (path === "/api/terminal" && init?.method === "POST") {
        return Response.json({ id: "term-1", pid: 1234 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab-mobile" />);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const io = socketFor("/api/terminal/io");
    socketFor("/api/terminal/control").open();
    io.open();

    expect(screen.getByLabelText("Клавиши терминала")).toBeInTheDocument();
    const ctrlButton = screen.getByRole("button", { name: "Переключить Ctrl" });

    fireEvent.click(ctrlButton);
    expect(ctrlButton).toHaveAttribute("aria-pressed", "true");
    terminalMock.FakeTerminal.instances[0]?.emitInput("c");

    expect(io.sent).toContain("\x03");
    await waitFor(() => expect(ctrlButton).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(screen.getByRole("button", { name: "Отправить Ctrl+C" }));

    expect(io.sent.filter((item) => item === "\x03")).toHaveLength(2);
  });
});
