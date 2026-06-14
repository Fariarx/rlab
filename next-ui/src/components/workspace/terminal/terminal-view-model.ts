export type TerminalControlMessage =
  | { readonly type: "restore"; readonly snapshot: string; readonly cols: number; readonly rows: number }
  | { readonly type: "state"; readonly id: string; readonly pid: number | null; readonly running: boolean; readonly exitCode: number | null }
  | { readonly type: "exit"; readonly code: number | null }
  | { readonly type: "error"; readonly message: string };

export interface TerminalSubscriber {
  readonly onStatus: (status: TerminalStatus) => void;
}

export interface TerminalStatus {
  readonly connecting: boolean;
  readonly running: boolean;
  readonly error: string | null;
  readonly exitCode: number | null;
}

export interface TerminalInputModifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export type TerminalInputModifier = keyof TerminalInputModifiers;

export const INACTIVE_TERMINAL_MODIFIERS: TerminalInputModifiers = { ctrl: false, alt: false };

export const MOBILE_STICKY_MODIFIERS: readonly { readonly key: TerminalInputModifier; readonly label: string }[] = [
  { key: "ctrl", label: "Ctrl" },
  { key: "alt", label: "Alt" },
];

export const MOBILE_KEY_SEQUENCES: readonly { readonly label: string; readonly ariaLabel?: string; readonly sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "Ctrl+C", sequence: "\x03" },
  { label: "Ctrl+D", sequence: "\x04" },
  { label: "Ctrl+L", sequence: "\x0c" },
  { label: "Ctrl+R", sequence: "\x12" },
  { label: "Ctrl+A", sequence: "\x01" },
  { label: "Ctrl+E", sequence: "\x05" },
  { label: "Ctrl+U", sequence: "\x15" },
  { label: "Ctrl+K", sequence: "\x0b" },
  { label: "↑", ariaLabel: "Up", sequence: "\x1b[A" },
  { label: "↓", ariaLabel: "Down", sequence: "\x1b[B" },
];

export function terminalWsUrl(path: "/api/terminal/io" | "/api/terminal/control", id: string, clientId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${path}`);
  url.searchParams.set("id", id);
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

export function decodeSocketChunk(data: string | ArrayBuffer | Blob): string | Uint8Array | null {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return null;
}

export function socketChunkByteLength(data: string | ArrayBuffer | Blob): number {
  if (typeof data === "string") {
    return new TextEncoder().encode(data).byteLength;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return 0;
}

export function controlSequenceForInput(data: string): string | null {
  if (data.length !== 1) {
    return null;
  }
  const codePoint = data.codePointAt(0);
  if (codePoint === undefined) {
    return null;
  }
  if (codePoint >= 97 && codePoint <= 122) {
    return String.fromCharCode(codePoint - 96);
  }
  if (codePoint >= 64 && codePoint <= 95) {
    return String.fromCharCode(codePoint - 64);
  }
  if (data === " ") {
    return "\x00";
  }
  if (data === "?") {
    return "\x7f";
  }
  if (data === "\r") {
    return "\r";
  }
  if (data === "\x7f" || data === "\b") {
    return "\b";
  }
  return null;
}

export function applyTerminalInputModifiers(data: string, modifiers: TerminalInputModifiers): { readonly data: string; readonly consumed: boolean } {
  let output = data;
  let consumed = false;
  if (modifiers.ctrl) {
    const controlSequence = controlSequenceForInput(output);
    if (controlSequence === null) {
      return { data, consumed: false };
    }
    output = controlSequence;
    consumed = true;
  }
  if (modifiers.alt) {
    output = `\x1b${output}`;
    consumed = true;
  }
  return { data: output, consumed };
}
