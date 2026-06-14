import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { createTerminalSession, deleteTerminalSession, type TerminalGeometry } from "../../../client/api/terminal-api";
import {
  applyTerminalInputModifiers,
  decodeSocketChunk,
  INACTIVE_TERMINAL_MODIFIERS,
  socketChunkByteLength,
  terminalWsUrl,
  type TerminalControlMessage,
  type TerminalInputModifiers,
  type TerminalStatus,
  type TerminalSubscriber,
} from "./terminal-view-model";

const terminals = new Map<string, RlabTerminal>();
const RESIZE_DEBOUNCE_MS = 50;
const START_LAYOUT_RETRY_MS = 50;
const MIN_START_PIXEL_WIDTH = 160;
const MIN_START_COLS = 20;
const TERMINAL_RECONNECT_DELAY_MS = 250;
const TERMINAL_RECONNECT_ATTEMPTS = 1;

function getTerminalClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `terminal-${Math.random().toString(36).slice(2, 10)}`;
}

function getParkingRoot(): HTMLDivElement {
  const existing = document.getElementById("rlab-terminal-parking-root");
  if (existing instanceof HTMLDivElement) {
    return existing;
  }
  const root = document.createElement("div");
  root.id = "rlab-terminal-parking-root";
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(root);
  return root;
}

export class RlabTerminal {
  private readonly terminal: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly hostElement = document.createElement("div");
  private readonly parkingRoot = getParkingRoot();
  private readonly subscribers = new Set<TerminalSubscriber>();
  private readonly clientId = getTerminalClientId();
  private status: TerminalStatus = { connecting: true, running: false, error: null, exitCode: null };
  private sessionId: string | null = null;
  private ioSocket: WebSocket | null = null;
  private controlSocket: WebSocket | null = null;
  private visibleContainer: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private startLayoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private inputModifiers: TerminalInputModifiers = INACTIVE_TERMINAL_MODIFIERS;
  private onInputModifiersConsumed: (() => void) | null = null;
  private terminalWriteQueue: Promise<void> = Promise.resolve();
  private opened = false;
  private stopped = false;
  private started = false;
  private starting = false;
  private reconnectAttempts = 0;
  private reconnecting = false;

  constructor(private readonly cwd: string) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: {
        background: "#080c10",
        foreground: "#e6edf3",
        cursor: "#4cc9ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#d29922",
        blue: "#79c0ff",
        magenta: "#d2a8ff",
        cyan: "#56d4dd",
        white: "#c9d1d9",
      },
    });
    this.hostElement.style.width = "100%";
    this.hostElement.style.height = "100%";
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.onData((data) => {
      this.sendTerminalInput(data);
    });
  }

  subscribe(subscriber: TerminalSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber.onStatus(this.status);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  mount(container: HTMLDivElement): void {
    this.visibleContainer = container;
    container.appendChild(this.hostElement);
    if (!this.opened) {
      this.terminal.open(this.hostElement);
      this.opened = true;
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(container);
    }
    window.requestAnimationFrame(() => {
      this.startWhenLayoutReady();
      this.terminal.focus();
    });
  }

  unmount(container: HTMLDivElement | null): void {
    if (container && this.visibleContainer !== container) {
      return;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.startLayoutTimer !== null) {
      clearTimeout(this.startLayoutTimer);
      this.startLayoutTimer = null;
    }
    this.visibleContainer = null;
    if (this.opened) {
      this.parkingRoot.appendChild(this.hostElement);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    this.controlSocket?.send(JSON.stringify({ type: "stop" }));
    if (this.sessionId) {
      await deleteTerminalSession(this.sessionId).catch(() => undefined);
    }
    this.ioSocket?.close();
    this.controlSocket?.close();
    this.updateStatus({ connecting: false, running: false, exitCode: 0, error: null });
  }

  setInputModifiers(modifiers: TerminalInputModifiers, onConsumed: () => void): void {
    this.inputModifiers = modifiers;
    this.onInputModifiersConsumed = onConsumed;
  }

  clearInputModifiers(): void {
    this.inputModifiers = INACTIVE_TERMINAL_MODIFIERS;
    this.onInputModifiersConsumed?.();
  }

  sendKeySequence(sequence: string): void {
    this.clearInputModifiers();
    this.sendInput(sequence);
    this.terminal.focus();
  }

  dispose(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.unmount(this.visibleContainer);
    this.ioSocket?.close();
    this.controlSocket?.close();
    this.terminal.dispose();
    this.hostElement.remove();
    this.subscribers.clear();
  }

  private async start(initialGeometry: TerminalGeometry | null): Promise<void> {
    if (this.started || this.starting || this.stopped) {
      if (this.started) {
        this.requestResize();
      }
      return;
    }
    this.starting = true;
    try {
      const sessionId = await createTerminalSession(this.cwd, initialGeometry);
      this.started = true;
      this.sessionId = sessionId;
      this.reconnectAttempts = 0;
      this.connectControl(sessionId);
      this.connectIo(sessionId);
      this.updateStatus({ connecting: false, running: true, error: null, exitCode: null });
    } catch (error) {
      this.updateStatus({ connecting: false, running: false, error: error instanceof Error ? error.message : String(error), exitCode: 1 });
    } finally {
      this.starting = false;
    }
  }

  private connectIo(id: string): void {
    if (this.stopped) {
      return;
    }
    const socket = new WebSocket(terminalWsUrl("/api/terminal/io", id, this.clientId));
    socket.binaryType = "arraybuffer";
    this.ioSocket = socket;
    socket.onopen = () => {
      if (this.ioSocket !== socket) {
        return;
      }
      this.updateStatus({ connecting: false, running: true, error: null, exitCode: null });
    };
    socket.onmessage = (event) => {
      if (this.ioSocket !== socket) {
        return;
      }
      const chunk = decodeSocketChunk(event.data as string | ArrayBuffer | Blob);
      if (chunk === null) {
        return;
      }
      void this.enqueueTerminalWrite(chunk, socketChunkByteLength(event.data as string | ArrayBuffer | Blob));
    };
    socket.onerror = () => {
      if (this.ioSocket === socket) {
        this.updateStatus({ error: "Terminal stream failed." });
      }
    };
    socket.onclose = () => {
      if (this.ioSocket !== socket) {
        return;
      }
      this.ioSocket = null;
      if (!this.stopped) {
        this.scheduleReconnect("Terminal stream closed.");
      }
    };
  }

  private connectControl(id: string): void {
    if (this.stopped) {
      return;
    }
    const socket = new WebSocket(terminalWsUrl("/api/terminal/control", id, this.clientId));
    this.controlSocket = socket;
    socket.onmessage = (event) => {
      if (this.controlSocket !== socket) {
        return;
      }
      let message: TerminalControlMessage;
      try {
        message = JSON.parse(String(event.data)) as TerminalControlMessage;
      } catch {
        this.updateStatus({ error: "Invalid terminal control message." });
        return;
      }
      this.handleControlMessage(message);
    };
    socket.onerror = () => {
      if (this.controlSocket === socket) {
        this.updateStatus({ error: "Terminal control connection failed." });
      }
    };
    socket.onclose = () => {
      if (this.controlSocket !== socket) {
        return;
      }
      this.controlSocket = null;
      if (!this.stopped) {
        this.scheduleReconnect("Terminal control connection closed.");
      }
    };
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped || !this.started || !this.sessionId) {
      return;
    }
    if (this.reconnecting || this.reconnectTimer !== null) {
      return;
    }
    if (this.reconnectAttempts >= TERMINAL_RECONNECT_ATTEMPTS) {
      this.updateStatus({ connecting: false, running: false, error: reason });
      return;
    }
    this.reconnectAttempts += 1;
    this.reconnecting = true;
    this.updateStatus({ connecting: true, running: true, error: null, exitCode: null });
    this.closeSocketsForReconnect();
    const terminalId = this.sessionId;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || this.sessionId !== terminalId) {
        this.reconnecting = false;
        return;
      }
      this.connectControl(terminalId);
      this.connectIo(terminalId);
    }, TERMINAL_RECONNECT_DELAY_MS);
  }

  private closeSocketsForReconnect(): void {
    const io = this.ioSocket;
    const control = this.controlSocket;
    this.ioSocket = null;
    this.controlSocket = null;
    if (io) {
      io.onclose = null;
      io.close();
    }
    if (control) {
      control.onclose = null;
      control.close();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
  }

  private handleControlMessage(message: TerminalControlMessage): void {
    if (message.type === "restore") {
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      void this.restore(message.snapshot, message.cols, message.rows);
      return;
    }
    if (message.type === "state") {
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      this.updateStatus({ running: message.running, exitCode: message.exitCode, error: null });
      return;
    }
    if (message.type === "exit") {
      void this.enqueueTerminalWrite(`\r\n[rlab] session exited${message.code == null ? "" : ` with code ${message.code}`}\r\n`, 0);
      this.updateStatus({ running: false, exitCode: message.code, error: null });
      return;
    }
    this.updateStatus({ error: message.message });
    void this.enqueueTerminalWrite(`\r\n[rlab] ${message.message}\r\n`, 0);
  }

  private async restore(snapshot: string, cols: number, rows: number): Promise<void> {
    await this.terminalWriteQueue.catch(() => undefined);
    this.terminal.reset();
    this.terminal.resize(cols, rows);
    if (snapshot) {
      await this.enqueueTerminalWrite(snapshot, 0);
    }
    this.controlSocket?.send(JSON.stringify({ type: "restore_complete" }));
    this.requestResize();
  }

  private enqueueTerminalWrite(data: string | Uint8Array, ackBytes: number): Promise<void> {
    this.terminalWriteQueue = this.terminalWriteQueue.catch(() => undefined).then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, () => {
            if (ackBytes > 0) {
              this.controlSocket?.send(JSON.stringify({ type: "output_ack", bytes: ackBytes }));
            }
            resolve();
          });
        }),
    );
    return this.terminalWriteQueue;
  }

  private sendInput(data: string): void {
    if (!this.ioSocket || this.ioSocket.readyState !== WebSocket.OPEN) {
      this.updateStatus({ error: "Terminal stream is not connected." });
      return;
    }
    this.ioSocket.send(data);
  }

  private sendTerminalInput(data: string): void {
    const transformed = applyTerminalInputModifiers(data, this.inputModifiers);
    this.sendInput(transformed.data);
    if (transformed.consumed) {
      this.clearInputModifiers();
    }
  }

  private scheduleResize(): void {
    if (!this.started) {
      this.startWhenLayoutReady();
      return;
    }
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.requestResize();
    }, RESIZE_DEBOUNCE_MS);
  }

  private startWhenLayoutReady(): void {
    if (this.started || this.starting || this.stopped) {
      return;
    }
    const geometry = this.fitToContainer();
    if (geometry && geometry.pixelWidth >= MIN_START_PIXEL_WIDTH && geometry.cols >= MIN_START_COLS) {
      if (this.startLayoutTimer !== null) {
        clearTimeout(this.startLayoutTimer);
        this.startLayoutTimer = null;
      }
      void this.start(geometry);
      return;
    }
    if (this.startLayoutTimer !== null) {
      return;
    }
    this.startLayoutTimer = setTimeout(() => {
      this.startLayoutTimer = null;
      this.startWhenLayoutReady();
    }, START_LAYOUT_RETRY_MS);
  }

  private requestResize(): void {
    if (!this.visibleContainer || !this.controlSocket || this.controlSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    const geometry = this.fitToContainer();
    if (!geometry) {
      return;
    }
    this.controlSocket.send(
      JSON.stringify({
        type: "resize",
        cols: geometry.cols,
        rows: geometry.rows,
        pixelWidth: geometry.pixelWidth,
        pixelHeight: geometry.pixelHeight,
      }),
    );
  }

  private fitToContainer(): TerminalGeometry | null {
    if (!this.visibleContainer) {
      return null;
    }
    this.fitAddon.fit();
    const bounds = this.visibleContainer.getBoundingClientRect();
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      pixelWidth: Math.max(1, Math.round(bounds.width)),
      pixelHeight: Math.max(1, Math.round(bounds.height)),
    };
  }

  private updateStatus(patch: Partial<TerminalStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const subscriber of this.subscribers) {
      subscriber.onStatus(this.status);
    }
  }
}

export function ensureTerminal(cwd: string): RlabTerminal {
  const existing = terminals.get(cwd);
  if (existing) {
    return existing;
  }
  const created = new RlabTerminal(cwd);
  terminals.set(cwd, created);
  return created;
}

export function disposeTerminal(cwd: string): void {
  const terminal = terminals.get(cwd);
  if (!terminal) {
    return;
  }
  terminal.dispose();
  terminals.delete(cwd);
}
