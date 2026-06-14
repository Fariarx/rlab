import { describe, expect, it } from "vitest";
import {
  applyTerminalInputModifiers,
  controlSequenceForInput,
  decodeSocketChunk,
  socketChunkByteLength,
  terminalWsUrl,
} from "../src/components/workspace/terminal/terminal-view-model";

describe("terminal-view-model", () => {
  it("builds terminal websocket URLs from the current browser location", () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const origin = `${protocol}//${window.location.host}`;

    expect(terminalWsUrl("/api/terminal/io", "term-1", "client-1")).toBe(`${origin}/api/terminal/io?id=term-1&clientId=client-1`);
    expect(terminalWsUrl("/api/terminal/control", "term-1", "client-1")).toBe(`${origin}/api/terminal/control?id=term-1&clientId=client-1`);
  });

  it("decodes supported websocket chunks and reports byte lengths", () => {
    const bytes = new Uint8Array([208, 162]).buffer;

    expect(decodeSocketChunk("abc")).toBe("abc");
    expect(decodeSocketChunk(bytes)).toEqual(new Uint8Array(bytes));
    expect(decodeSocketChunk(new Blob(["abc"]))).toBeNull();
    expect(socketChunkByteLength("Т")).toBe(2);
    expect(socketChunkByteLength(bytes)).toBe(2);
    expect(socketChunkByteLength(new Blob(["abc"]))).toBe(0);
  });

  it("maps ctrl input to terminal control sequences", () => {
    expect(controlSequenceForInput("a")).toBe("\x01");
    expect(controlSequenceForInput("z")).toBe("\x1a");
    expect(controlSequenceForInput("@")).toBe("\x00");
    expect(controlSequenceForInput("_")).toBe("\x1f");
    expect(controlSequenceForInput(" ")).toBe("\x00");
    expect(controlSequenceForInput("?")).toBe("\x7f");
    expect(controlSequenceForInput("\r")).toBe("\r");
    expect(controlSequenceForInput("\b")).toBe("\b");
    expect(controlSequenceForInput("ab")).toBeNull();
  });

  it("applies sticky ctrl and alt modifiers to terminal input", () => {
    expect(applyTerminalInputModifiers("c", { ctrl: true, alt: false })).toEqual({ data: "\x03", consumed: true });
    expect(applyTerminalInputModifiers("x", { ctrl: false, alt: true })).toEqual({ data: "\x1bx", consumed: true });
    expect(applyTerminalInputModifiers("c", { ctrl: true, alt: true })).toEqual({ data: "\x1b\x03", consumed: true });
    expect(applyTerminalInputModifiers("ab", { ctrl: true, alt: false })).toEqual({ data: "ab", consumed: false });
    expect(applyTerminalInputModifiers("ab", { ctrl: false, alt: false })).toEqual({ data: "ab", consumed: false });
  });
});
