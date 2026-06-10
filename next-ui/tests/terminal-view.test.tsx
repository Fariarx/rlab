import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("TerminalView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        expect.objectContaining({ method: "POST", headers: { "X-Rlab-Terminal-Cwd": "/root/workspace/rlab" } }),
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

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/terminal", expect.objectContaining({ method: "POST", headers: { "X-Rlab-Terminal-Cwd": "/root/workspace/rlab-restart" } })));
    await waitFor(() => expect(createCount).toBe(2));
    expect(FakeWebSocket.instances.length).toBe(4);
  });

  it("runs a popular mobile command in the active terminal session", async () => {
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

    expect(screen.getByLabelText("Популярные команды")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выполнить pwd" }));

    expect(io.sent).toContain("pwd\r");
  });
});
