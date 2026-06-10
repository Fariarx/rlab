import serializeAddonModule from "@xterm/addon-serialize";
import headlessTerminalModule from "@xterm/headless";
import type { SerializeAddon as SerializeAddonInstance } from "@xterm/addon-serialize";
import type { ITerminalOptions as HeadlessTerminalOptions, Terminal as HeadlessTerminalInstance } from "@xterm/headless";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import process from "node:process";
import * as pty from "node-pty";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";

export interface TerminalSessionCreateRequest {
  readonly cwd: string;
  readonly cols?: number;
  readonly rows?: number;
}

export interface TerminalCreateResult {
  readonly id: string;
  readonly pid: number;
}

export interface TerminalRestoreSnapshot {
  readonly snapshot: string;
  readonly cols: number;
  readonly rows: number;
}

type TerminalControlClientMessage =
  | { readonly type: "resize"; readonly cols: number; readonly rows: number; readonly pixelWidth?: number; readonly pixelHeight?: number }
  | { readonly type: "stop" }
  | { readonly type: "restore_complete" }
  | { readonly type: "output_ack"; readonly bytes: number };

type TerminalControlServerMessage =
  | { readonly type: "restore"; readonly snapshot: string; readonly cols: number; readonly rows: number }
  | { readonly type: "state"; readonly id: string; readonly pid: number | null; readonly running: boolean; readonly exitCode: number | null }
  | { readonly type: "exit"; readonly code: number | null }
  | { readonly type: "error"; readonly message: string };

interface TerminalListener {
  readonly onOutput?: (chunk: Buffer) => void;
  readonly onState?: (session: TerminalSession) => void;
  readonly onExit?: (code: number | null) => void;
}

interface TerminalSession {
  readonly id: string;
  readonly cwd: string;
  readonly ptyProcess: pty.IPty;
  readonly mirror: TerminalStateMirror;
  readonly listeners: Map<number, TerminalListener>;
  listenerCounter: number;
  running: boolean;
  exitCode: number | null;
}

interface TerminalViewer {
  readonly clientId: string;
  pendingOutputChunks: Buffer[];
  restoreComplete: boolean;
  ioState: IoOutputState | null;
  ioSocket: WebSocket | null;
  controlSocket: WebSocket | null;
  detachControlListener: (() => void) | null;
  flushPendingOutput: () => void;
}

interface TerminalStreamState {
  readonly viewers: Map<string, TerminalViewer>;
  readonly backpressuredViewerIds: Set<string>;
  detachOutputListener: (() => void) | null;
}

interface IoOutputState {
  enqueueOutput: (chunk: Buffer) => void;
  acknowledgeOutput: (bytes: number) => void;
  dispose: () => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const TERMINAL_SCROLLBACK = 10_000;
const OUTPUT_BATCH_INTERVAL_MS = 4;
const LOW_LATENCY_CHUNK_BYTES = 256;
const LOW_LATENCY_IDLE_WINDOW_MS = 5;
const OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES = 16 * 1024;
const OUTPUT_BUFFER_LOW_WATER_MARK_BYTES = 4 * 1024;
const OUTPUT_ACK_HIGH_WATER_MARK_BYTES = 100_000;
const OUTPUT_ACK_LOW_WATER_MARK_BYTES = 5_000;
const OUTPUT_RESUME_CHECK_INTERVAL_MS = 16;

type SerializeAddonConstructor = new () => SerializeAddonInstance;
type HeadlessTerminalConstructorOptions = HeadlessTerminalOptions & { readonly cols?: number; readonly rows?: number };
type HeadlessTerminalConstructor = new (options?: HeadlessTerminalConstructorOptions) => HeadlessTerminalInstance;

const { SerializeAddon } = serializeAddonModule as unknown as { readonly SerializeAddon: SerializeAddonConstructor };
const { Terminal: HeadlessTerminal } = headlessTerminalModule as unknown as { readonly Terminal: HeadlessTerminalConstructor };

function normalizeTerminalSize(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.max(1, Math.floor(value ?? fallback)) : fallback;
}

function terminalLaunch(): { readonly command: string; readonly args: readonly string[] } {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/q"] };
  }
  return { command: process.env.SHELL || "/bin/bash", args: [] };
}

function createTerminalEnv(): Record<string, string> {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "rlab",
  };
}

function normalizePtyOutput(data: string | Buffer | Uint8Array): Buffer {
  if (typeof data === "string") {
    return Buffer.from(data, "utf8");
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function parseControlMessage(message: RawData): TerminalControlClientMessage | null {
  try {
    const parsed = JSON.parse(message.toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.type === "resize" && typeof candidate.cols === "number" && typeof candidate.rows === "number") {
      return {
        type: "resize",
        cols: candidate.cols,
        rows: candidate.rows,
        pixelWidth: typeof candidate.pixelWidth === "number" ? candidate.pixelWidth : undefined,
        pixelHeight: typeof candidate.pixelHeight === "number" ? candidate.pixelHeight : undefined,
      };
    }
    if (candidate.type === "stop" || candidate.type === "restore_complete") {
      return { type: candidate.type };
    }
    if (candidate.type === "output_ack" && typeof candidate.bytes === "number") {
      return { type: "output_ack", bytes: candidate.bytes };
    }
  } catch {
    return null;
  }
  return null;
}

function rawDataToBuffer(message: RawData): Buffer {
  if (Buffer.isBuffer(message)) {
    return message;
  }
  if (Array.isArray(message)) {
    return Buffer.concat(message.map((part) => rawDataToBuffer(part)));
  }
  return Buffer.from(message.toString(), "utf8");
}

function sendControlMessage(ws: WebSocket, message: TerminalControlServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getWebSocketTransportSocket(ws: WebSocket): Socket | null {
  const transportSocket = (ws as WebSocket & { _socket?: Socket })._socket;
  return transportSocket ?? null;
}

function socketUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `http://${host}`);
}

function terminalSummary(session: TerminalSession): Extract<TerminalControlServerMessage, { type: "state" }> {
  return {
    type: "state",
    id: session.id,
    pid: session.running ? session.ptyProcess.pid : null,
    running: session.running,
    exitCode: session.exitCode,
  };
}

class TerminalStateMirror {
  private readonly terminal: HeadlessTerminalInstance;
  private readonly serializeAddon = new SerializeAddon();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(cols: number, rows: number) {
    this.terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: TERMINAL_SCROLLBACK,
    });
    this.terminal.loadAddon(this.serializeAddon);
  }

  applyOutput(chunk: Buffer): void {
    const copy = new Uint8Array(chunk);
    this.enqueueOperation(() => new Promise<void>((resolve) => this.terminal.write(copy, resolve)));
  }

  resize(cols: number, rows: number): void {
    if (this.terminal.cols === cols && this.terminal.rows === rows) {
      return;
    }
    this.enqueueOperation(() => this.terminal.resize(cols, rows));
  }

  async getSnapshot(): Promise<TerminalRestoreSnapshot> {
    await this.operationQueue;
    return {
      snapshot: this.serializeAddon.serialize(),
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private enqueueOperation(operation: () => void | Promise<void>): void {
    this.operationQueue = this.operationQueue.catch(() => undefined).then(operation);
  }
}

export class PtyTerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  create({ cwd, cols, rows }: TerminalSessionCreateRequest): TerminalCreateResult {
    const id = `term-${randomUUID()}`;
    const launch = terminalLaunch();
    const resolvedCols = normalizeTerminalSize(cols, DEFAULT_COLS);
    const resolvedRows = normalizeTerminalSize(rows, DEFAULT_ROWS);
    const mirror = new TerminalStateMirror(resolvedCols, resolvedRows);
    const ptyProcess = pty.spawn(launch.command, [...launch.args], {
      name: "xterm-256color",
      cwd,
      env: createTerminalEnv(),
      cols: resolvedCols,
      rows: resolvedRows,
      encoding: null,
    });
    const session: TerminalSession = {
      id,
      cwd,
      ptyProcess,
      mirror,
      listeners: new Map(),
      listenerCounter: 1,
      running: true,
      exitCode: null,
    };
    this.sessions.set(id, session);
    (ptyProcess.onData as unknown as (listener: (data: string | Buffer | Uint8Array) => void) => void)((data) => {
      const chunk = normalizePtyOutput(data);
      mirror.applyOutput(chunk);
      for (const listener of session.listeners.values()) {
        listener.onOutput?.(chunk);
      }
    });
    ptyProcess.onExit((event) => {
      session.running = false;
      session.exitCode = event.exitCode;
      for (const listener of session.listeners.values()) {
        listener.onState?.(session);
        listener.onExit?.(event.exitCode);
      }
      session.mirror.dispose();
      this.sessions.delete(id);
    });
    return { id, pid: ptyProcess.pid };
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    this.sessions.delete(id);
    session.running = false;
    session.exitCode = session.exitCode ?? 0;
    session.ptyProcess.kill();
    session.mirror.dispose();
    for (const listener of session.listeners.values()) {
      listener.onState?.(session);
      listener.onExit?.(session.exitCode);
    }
    return true;
  }

  attach(id: string, listener: TerminalListener): (() => void) | null {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }
    listener.onState?.(session);
    const listenerId = session.listenerCounter;
    session.listenerCounter += 1;
    session.listeners.set(listenerId, listener);
    return () => {
      session.listeners.delete(listenerId);
    };
  }

  get(id: string): TerminalSession | null {
    return this.sessions.get(id) ?? null;
  }

  async getSnapshot(id: string): Promise<TerminalRestoreSnapshot | null> {
    const session = this.sessions.get(id);
    return session ? await session.mirror.getSnapshot() : null;
  }

  write(id: string, data: Buffer): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.running) {
      return false;
    }
    session.ptyProcess.write(data.toString("utf8"));
    return true;
  }

  resize(id: string, cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.running) {
      return false;
    }
    const resolvedCols = normalizeTerminalSize(cols, DEFAULT_COLS);
    const resolvedRows = normalizeTerminalSize(rows, DEFAULT_ROWS);
    try {
      if (pixelWidth && pixelHeight) {
        session.ptyProcess.resize(resolvedCols, resolvedRows, { width: Math.floor(pixelWidth), height: Math.floor(pixelHeight) });
      } else {
        session.ptyProcess.resize(resolvedCols, resolvedRows);
      }
    } catch {
      return false;
    }
    session.mirror.resize(resolvedCols, resolvedRows);
    return true;
  }

  pause(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.running) {
      return false;
    }
    session.ptyProcess.pause();
    return true;
  }

  resume(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.running) {
      return false;
    }
    session.ptyProcess.resume();
    return true;
  }
}

function createIoOutputState(ws: WebSocket, streamState: TerminalStreamState, clientId: string, terminalId: string, terminalManager: PtyTerminalManager): IoOutputState {
  let pendingOutputChunks: Buffer[] = [];
  let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOutputSentAt = 0;
  let outputPaused = false;
  let resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let unacknowledgedOutputBytes = 0;

  const shouldPauseOutput = () => ws.bufferedAmount >= OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES || unacknowledgedOutputBytes >= OUTPUT_ACK_HIGH_WATER_MARK_BYTES;
  const canResumeOutput = () => ws.bufferedAmount < OUTPUT_BUFFER_LOW_WATER_MARK_BYTES && unacknowledgedOutputBytes < OUTPUT_ACK_LOW_WATER_MARK_BYTES;

  const clearResumeCheck = () => {
    if (resumeCheckTimer !== null) {
      clearTimeout(resumeCheckTimer);
      resumeCheckTimer = null;
    }
    getWebSocketTransportSocket(ws)?.removeListener("drain", checkResumeAfterBackpressure);
  };

  const scheduleResumeCheck = () => {
    if (!outputPaused) {
      return;
    }
    clearResumeCheck();
    getWebSocketTransportSocket(ws)?.once("drain", checkResumeAfterBackpressure);
    resumeCheckTimer = setTimeout(() => {
      resumeCheckTimer = null;
      checkResumeAfterBackpressure();
    }, OUTPUT_RESUME_CHECK_INTERVAL_MS);
  };

  function checkResumeAfterBackpressure(): void {
    if (!outputPaused) {
      clearResumeCheck();
      return;
    }
    if (ws.readyState !== ws.OPEN) {
      return;
    }
    if (canResumeOutput()) {
      outputPaused = false;
      clearResumeCheck();
      streamState.backpressuredViewerIds.delete(clientId);
      if (streamState.backpressuredViewerIds.size === 0) {
        terminalManager.resume(terminalId);
      }
      return;
    }
    scheduleResumeCheck();
  }

  const sendOutputChunk = (chunk: Buffer) => {
    if (ws.readyState !== ws.OPEN) {
      return;
    }
    ws.send(chunk);
    lastOutputSentAt = Date.now();
    unacknowledgedOutputBytes += chunk.byteLength;
    if (!outputPaused && shouldPauseOutput()) {
      outputPaused = true;
      const alreadyBackpressured = streamState.backpressuredViewerIds.size > 0;
      streamState.backpressuredViewerIds.add(clientId);
      if (!alreadyBackpressured) {
        terminalManager.pause(terminalId);
      }
      scheduleResumeCheck();
    }
  };

  const flushOutputBatch = () => {
    outputFlushTimer = null;
    if (pendingOutputChunks.length === 0 || ws.readyState !== ws.OPEN) {
      pendingOutputChunks = [];
      return;
    }
    sendOutputChunk(Buffer.concat(pendingOutputChunks));
    pendingOutputChunks = [];
  };

  return {
    enqueueOutput: (chunk) => {
      const now = Date.now();
      if (pendingOutputChunks.length === 0 && outputFlushTimer === null && chunk.byteLength <= LOW_LATENCY_CHUNK_BYTES && now - lastOutputSentAt >= LOW_LATENCY_IDLE_WINDOW_MS) {
        sendOutputChunk(chunk);
        return;
      }
      pendingOutputChunks.push(chunk);
      if (outputFlushTimer === null) {
        outputFlushTimer = setTimeout(flushOutputBatch, OUTPUT_BATCH_INTERVAL_MS);
      }
    },
    acknowledgeOutput: (bytes) => {
      unacknowledgedOutputBytes = Math.max(0, unacknowledgedOutputBytes - Math.max(0, Math.floor(bytes)));
      checkResumeAfterBackpressure();
    },
    dispose: () => {
      if (outputFlushTimer !== null) {
        clearTimeout(outputFlushTimer);
      }
      clearResumeCheck();
      if (outputPaused) {
        streamState.backpressuredViewerIds.delete(clientId);
        if (streamState.backpressuredViewerIds.size === 0) {
          terminalManager.resume(terminalId);
        }
      }
      pendingOutputChunks = [];
    },
  };
}

export function attachPtyTerminalWebSockets(server: Server, terminalManager: PtyTerminalManager): () => Promise<void> {
  const terminalStreamStates = new Map<string, TerminalStreamState>();
  const ioServer = new WebSocketServer({ noServer: true });
  const controlServer = new WebSocketServer({ noServer: true });

  const getOrCreateStreamState = (terminalId: string): TerminalStreamState => {
    const existing = terminalStreamStates.get(terminalId);
    if (existing) {
      return existing;
    }
    const created: TerminalStreamState = {
      viewers: new Map(),
      backpressuredViewerIds: new Set(),
      detachOutputListener: null,
    };
    terminalStreamStates.set(terminalId, created);
    return created;
  };

  const cleanupStreamStateIfUnused = (terminalId: string): void => {
    const state = terminalStreamStates.get(terminalId);
    if (!state || state.viewers.size > 0) {
      return;
    }
    state.detachOutputListener?.();
    terminalStreamStates.delete(terminalId);
  };

  const getOrCreateViewer = (streamState: TerminalStreamState, clientId: string): TerminalViewer => {
    const existing = streamState.viewers.get(clientId);
    if (existing) {
      return existing;
    }
    const created: TerminalViewer = {
      clientId,
      pendingOutputChunks: [],
      restoreComplete: false,
      ioState: null,
      ioSocket: null,
      controlSocket: null,
      detachControlListener: null,
      flushPendingOutput: () => {
        if (!created.restoreComplete || !created.ioState) {
          return;
        }
        for (const chunk of created.pendingOutputChunks) {
          created.ioState.enqueueOutput(chunk);
        }
        created.pendingOutputChunks = [];
      },
    };
    streamState.viewers.set(clientId, created);
    return created;
  };

  const cleanupViewerIfUnused = (terminalId: string, streamState: TerminalStreamState, viewer: TerminalViewer): void => {
    if (viewer.ioSocket || viewer.controlSocket) {
      return;
    }
    viewer.detachControlListener?.();
    streamState.viewers.delete(viewer.clientId);
    cleanupStreamStateIfUnused(terminalId);
  };

  const ensureOutputListener = (terminalId: string, streamState: TerminalStreamState): void => {
    if (streamState.detachOutputListener) {
      return;
    }
    streamState.detachOutputListener = terminalManager.attach(terminalId, {
      onOutput: (chunk) => {
        for (const viewer of streamState.viewers.values()) {
          if (viewer.restoreComplete && viewer.ioState) {
            viewer.ioState.enqueueOutput(chunk);
          } else {
            viewer.pendingOutputChunks.push(chunk);
          }
        }
      },
    });
  };

  const handleUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = socketUrl(request);
    const isIo = url.pathname === "/api/terminal/io";
    const isControl = url.pathname === "/api/terminal/control";
    if (!isIo && !isControl) {
      return;
    }
    const terminalId = url.searchParams.get("id")?.trim() ?? "";
    const clientId = url.searchParams.get("clientId")?.trim() || "default";
    if (!terminalId || !terminalManager.get(terminalId)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const target = isIo ? ioServer : controlServer;
    target.handleUpgrade(request, socket, head, (ws) => {
      target.emit("connection", ws, { terminalId, clientId });
    });
  };

  server.on("upgrade", handleUpgrade);

  ioServer.on("connection", (ws, context) => {
    const { terminalId, clientId } = context as unknown as { terminalId: string; clientId: string };
    const streamState = getOrCreateStreamState(terminalId);
    const viewer = getOrCreateViewer(streamState, clientId);
    const previousSocket = viewer.ioSocket;
    viewer.ioState?.dispose();
    viewer.ioState = createIoOutputState(ws, streamState, clientId, terminalId, terminalManager);
    viewer.ioSocket = ws;
    viewer.flushPendingOutput();
    ensureOutputListener(terminalId, streamState);
    if (previousSocket && previousSocket !== ws) {
      previousSocket.close(1000, "Replaced by newer terminal stream.");
    }

    ws.on("message", (rawMessage) => {
      if (!terminalManager.write(terminalId, rawDataToBuffer(rawMessage))) {
        ws.close(1011, "Terminal session is not running.");
      }
    });
    ws.on("close", () => {
      if (viewer.ioSocket !== ws) {
        return;
      }
      viewer.ioSocket = null;
      viewer.ioState?.dispose();
      viewer.ioState = null;
      cleanupViewerIfUnused(terminalId, streamState, viewer);
    });
  });

  controlServer.on("connection", (ws, context) => {
    const { terminalId, clientId } = context as unknown as { terminalId: string; clientId: string };
    const streamState = getOrCreateStreamState(terminalId);
    const viewer = getOrCreateViewer(streamState, clientId);
    const previousSocket = viewer.controlSocket;
    viewer.restoreComplete = false;
    viewer.pendingOutputChunks = [];
    viewer.controlSocket = ws;
    ensureOutputListener(terminalId, streamState);
    viewer.detachControlListener?.();
    viewer.detachControlListener = terminalManager.attach(terminalId, {
      onState: (session) => sendControlMessage(ws, terminalSummary(session)),
      onExit: (code) => sendControlMessage(ws, { type: "exit", code }),
    });
    if (previousSocket && previousSocket !== ws) {
      previousSocket.close(1000, "Replaced by newer terminal control connection.");
    }

    void terminalManager.getSnapshot(terminalId).then((snapshot) => {
      if (!snapshot) {
        sendControlMessage(ws, { type: "error", message: "Terminal session not found." });
        return;
      }
      sendControlMessage(ws, { type: "restore", snapshot: snapshot.snapshot, cols: snapshot.cols, rows: snapshot.rows });
    });

    ws.on("message", (rawMessage) => {
      const message = parseControlMessage(rawMessage);
      if (!message) {
        sendControlMessage(ws, { type: "error", message: "Invalid terminal control payload." });
        return;
      }
      if (message.type === "resize") {
        terminalManager.resize(terminalId, message.cols, message.rows, message.pixelWidth, message.pixelHeight);
        return;
      }
      if (message.type === "stop") {
        terminalManager.close(terminalId);
        return;
      }
      if (message.type === "output_ack") {
        viewer.ioState?.acknowledgeOutput(message.bytes);
        return;
      }
      viewer.restoreComplete = true;
      viewer.flushPendingOutput();
    });
    ws.on("close", () => {
      if (viewer.controlSocket !== ws) {
        return;
      }
      viewer.controlSocket = null;
      viewer.detachControlListener?.();
      viewer.detachControlListener = null;
      cleanupViewerIfUnused(terminalId, streamState, viewer);
    });
  });

  return async () => {
    server.off("upgrade", handleUpgrade);
    for (const client of ioServer.clients) {
      client.terminate();
    }
    for (const client of controlServer.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => ioServer.close(() => controlServer.close(() => resolve())));
  };
}
