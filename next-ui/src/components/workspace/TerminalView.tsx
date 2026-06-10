import "@xterm/xterm/css/xterm.css";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, IconButton } from "../ui";

type TerminalControlMessage =
  | { readonly type: "restore"; readonly snapshot: string; readonly cols: number; readonly rows: number }
  | { readonly type: "state"; readonly id: string; readonly pid: number | null; readonly running: boolean; readonly exitCode: number | null }
  | { readonly type: "exit"; readonly code: number | null }
  | { readonly type: "error"; readonly message: string };

interface TerminalSubscriber {
  readonly onStatus: (status: TerminalStatus) => void;
}

interface TerminalStatus {
  readonly connecting: boolean;
  readonly running: boolean;
  readonly error: string | null;
  readonly exitCode: number | null;
}

interface TerminalCreateResponse {
  readonly id?: string;
  readonly error?: string;
}

const terminals = new Map<string, RlabTerminal>();
const RESIZE_DEBOUNCE_MS = 50;
const MOBILE_POPULAR_COMMANDS: readonly { readonly label: string; readonly command: string }[] = [
  { label: "pwd", command: "pwd" },
  { label: "ls", command: "ls -la" },
  { label: "git", command: "git status --short" },
  { label: "diff", command: "git diff --stat" },
  { label: "test", command: "npm test" },
  { label: "build", command: "npm run build" },
];

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

function terminalWsUrl(path: "/api/terminal/io" | "/api/terminal/control", id: string, clientId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${path}`);
  url.searchParams.set("id", id);
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

function decodeSocketChunk(decoder: TextDecoder, data: string | ArrayBuffer | Blob): string | Uint8Array | null {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return null;
}

function socketChunkByteLength(data: string | ArrayBuffer | Blob): number {
  if (typeof data === "string") {
    return new TextEncoder().encode(data).byteLength;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return 0;
}

class RlabTerminal {
  private readonly terminal: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly hostElement = document.createElement("div");
  private readonly parkingRoot = getParkingRoot();
  private readonly subscribers = new Set<TerminalSubscriber>();
  private readonly clientId = getTerminalClientId();
  private readonly decoder = new TextDecoder();
  private status: TerminalStatus = { connecting: true, running: false, error: null, exitCode: null };
  private sessionId: string | null = null;
  private ioSocket: WebSocket | null = null;
  private controlSocket: WebSocket | null = null;
  private visibleContainer: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalWriteQueue: Promise<void> = Promise.resolve();
  private opened = false;
  private stopped = false;

  constructor(private readonly cwd: string) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: true,
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
      this.sendInput(data);
    });
    void this.start();
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
      this.requestResize();
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
    this.visibleContainer = null;
    if (this.opened) {
      this.parkingRoot.appendChild(this.hostElement);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controlSocket?.send(JSON.stringify({ type: "stop" }));
    if (this.sessionId) {
      await fetch(`/api/terminal?id=${encodeURIComponent(this.sessionId)}`, { method: "DELETE" }).catch(() => undefined);
    }
    this.ioSocket?.close();
    this.controlSocket?.close();
    this.updateStatus({ connecting: false, running: false, exitCode: 0, error: null });
  }

  sendCommand(command: string): void {
    this.sendInput(`${command}\r`);
    this.terminal.focus();
  }

  dispose(): void {
    this.stopped = true;
    this.unmount(this.visibleContainer);
    this.ioSocket?.close();
    this.controlSocket?.close();
    this.terminal.dispose();
    this.hostElement.remove();
    this.subscribers.clear();
  }

  private async start(): Promise<void> {
    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "X-Rlab-Terminal-Cwd": this.cwd },
      });
      const payload = (await response.json().catch(() => ({}))) as TerminalCreateResponse;
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? `Terminal failed (${response.status})`);
      }
      this.sessionId = payload.id;
      this.connectControl(payload.id);
      this.connectIo(payload.id);
      this.updateStatus({ connecting: false, running: true, error: null, exitCode: null });
    } catch (error) {
      this.updateStatus({ connecting: false, running: false, error: error instanceof Error ? error.message : String(error), exitCode: 1 });
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
      const chunk = decodeSocketChunk(this.decoder, event.data as string | ArrayBuffer | Blob);
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
        this.updateStatus({ running: false, error: "Terminal stream closed." });
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
        this.updateStatus({ running: false, error: "Terminal control connection closed." });
      }
    };
  }

  private handleControlMessage(message: TerminalControlMessage): void {
    if (message.type === "restore") {
      void this.restore(message.snapshot, message.cols, message.rows);
      return;
    }
    if (message.type === "state") {
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

  private scheduleResize(): void {
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.requestResize();
    }, RESIZE_DEBOUNCE_MS);
  }

  private requestResize(): void {
    if (!this.visibleContainer || !this.controlSocket || this.controlSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.fitAddon.fit();
    const bounds = this.visibleContainer.getBoundingClientRect();
    this.controlSocket.send(
      JSON.stringify({
        type: "resize",
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        pixelWidth: Math.max(1, Math.round(bounds.width)),
        pixelHeight: Math.max(1, Math.round(bounds.height)),
      }),
    );
  }

  private updateStatus(patch: Partial<TerminalStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const subscriber of this.subscribers) {
      subscriber.onStatus(this.status);
    }
  }
}

function ensureTerminal(cwd: string): RlabTerminal {
  const existing = terminals.get(cwd);
  if (existing) {
    return existing;
  }
  const created = new RlabTerminal(cwd);
  terminals.set(cwd, created);
  return created;
}

function disposeTerminal(cwd: string): void {
  const terminal = terminals.get(cwd);
  if (!terminal) {
    return;
  }
  terminal.dispose();
  terminals.delete(cwd);
}

export function TerminalView({ cwd }: { readonly cwd?: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<RlabTerminal | null>(null);
  const [status, setStatus] = useState<TerminalStatus>({ connecting: Boolean(cwd), running: false, error: null, exitCode: null });
  const [terminalEpoch, setTerminalEpoch] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!cwd || !container) {
      return;
    }
    const terminal = ensureTerminal(cwd);
    terminalRef.current = terminal;
    const unsubscribe = terminal.subscribe({ onStatus: setStatus });
    terminal.mount(container);
    return () => {
      unsubscribe();
      terminal.unmount(container);
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    };
  }, [cwd, terminalEpoch]);

  const stopTerminal = () => {
    if (!cwd || !terminalRef.current) {
      return;
    }
    const terminal = terminalRef.current;
    void terminal.stop().finally(() => {
      disposeTerminal(cwd);
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    });
  };
  const restartTerminal = () => {
    if (!cwd) {
      return;
    }
    disposeTerminal(cwd);
    terminalRef.current = null;
    setStatus({ connecting: true, running: false, error: null, exitCode: null });
    setTerminalEpoch((value) => value + 1);
  };
  const sendPopularCommand = (command: string) => {
    terminalRef.current?.sendCommand(command);
  };

  if (!cwd) {
    return (
      <Stack sx={{ height: "100%", minHeight: 0, justifyContent: "center", alignItems: "center", px: 3, py: 4, backgroundColor: "#080c10" }}>
        <EmptyState icon={<TerminalIcon />} title={t("terminalTab")} description={t("gitNoProject")} />
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: "#080c10" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          flex: "0 0 auto",
          px: 1.25,
          py: 0.8,
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          backgroundColor: "#0d1318",
        }}
      >
        <TerminalIcon sx={{ fontSize: 17, color: "text.secondary" }} />
        <Typography noWrap sx={{ minWidth: 0, flex: 1, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", color: "text.tertiary" }}>
          {cwd}
        </Typography>
        {status.connecting && <CircularProgress size={13} />}
        {status.error && (
          <Typography noWrap sx={{ maxWidth: "40%", fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>
            {status.error}
          </Typography>
        )}
        {status.exitCode !== null && status.exitCode !== 0 && (
          <Typography sx={{ fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>{t("terminalExitCode", { code: status.exitCode })}</Typography>
        )}
        {status.running && (
          <IconButton aria-label={t("stopTerminalCommand")} tone="danger" onClick={stopTerminal} sx={{ width: 28, height: 28, flex: "0 0 auto" }}>
            <StopCircleOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        )}
        {!status.running && !status.connecting && (
          <IconButton aria-label={status.exitCode === null ? t("openTerminalCommand") : t("restartTerminalCommand")} onClick={restartTerminal} sx={{ width: 28, height: 28, flex: "0 0 auto" }}>
            {status.exitCode === null ? <PlayArrowRoundedIcon sx={{ fontSize: 17 }} /> : <ReplayRoundedIcon sx={{ fontSize: 17 }} />}
          </IconButton>
        )}
      </Stack>
      <Stack
        direction="row"
        aria-label={t("terminalPopularCommands")}
        sx={{
          display: { xs: "flex", sm: "none" },
          flex: "0 0 auto",
          gap: 0.75,
          px: 1,
          py: 0.75,
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          backgroundColor: "#0a0f14",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {MOBILE_POPULAR_COMMANDS.map((item) => (
          <Box
            key={item.command}
            component="button"
            type="button"
            disabled={!status.running}
            aria-label={t("terminalRunCommand", { command: item.command })}
            onClick={() => sendPopularCommand(item.command)}
            sx={{
              flex: "0 0 auto",
              scrollSnapAlign: "start",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              minHeight: 34,
              px: 1,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              backgroundColor: (theme) => theme.custom.surfaces.s2,
              color: "text.primary",
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.72rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
              cursor: status.running ? "pointer" : "default",
              opacity: status.running ? 1 : 0.5,
              "&:active": {
                backgroundColor: (theme) => theme.custom.surfaces.s4,
              },
            }}
          >
            <Box component="span">{item.label}</Box>
            <ChevronRightIcon sx={{ fontSize: 14, color: "text.secondary" }} />
          </Box>
        ))}
      </Stack>
      <Box
        ref={containerRef}
        role="log"
        aria-label={t("terminalOutput")}
        aria-busy={status.connecting ? "true" : "false"}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: "#080c10",
          "& .xterm": { height: "100%", p: 1 },
          "& .xterm-viewport": { backgroundColor: "#080c10 !important" },
          "& .xterm-screen": { outline: "none" },
        }}
      />
    </Stack>
  );
}
