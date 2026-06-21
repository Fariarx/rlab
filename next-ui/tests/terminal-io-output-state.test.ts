import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalIoOutputState, type TerminalOutputSocket } from "../src/server/terminal-io-output-state";

class FakeOutputSocket implements TerminalOutputSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  readonly sent: Buffer[] = [];

  send(chunk: Buffer): void {
    this.sent.push(Buffer.from(chunk));
  }
}

function createTerminalManager() {
  return {
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
  };
}

describe("terminal-io-output-state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends small chunks immediately after an idle window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const ws = new FakeOutputSocket();
    const terminalManager = createTerminalManager();
    const state = createTerminalIoOutputState({
      ws,
      streamState: { backpressuredViewerIds: new Set() },
      clientId: "client-1",
      terminalId: "term-1",
      terminalManager,
      lowLatencyIdleWindowMs: 5,
    });

    state.enqueueOutput(Buffer.from("a"));

    expect(ws.sent.map((chunk) => chunk.toString("utf8"))).toEqual(["a"]);
    expect(terminalManager.pause).not.toHaveBeenCalled();
  });

  it("batches rapid output chunks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ws = new FakeOutputSocket();
    const terminalManager = createTerminalManager();
    const state = createTerminalIoOutputState({
      ws,
      streamState: { backpressuredViewerIds: new Set() },
      clientId: "client-1",
      terminalId: "term-1",
      terminalManager,
      outputBatchIntervalMs: 4,
      lowLatencyIdleWindowMs: 5,
    });

    state.enqueueOutput(Buffer.from("a"));
    state.enqueueOutput(Buffer.from("b"));
    expect(ws.sent).toHaveLength(0);

    vi.advanceTimersByTime(4);

    expect(ws.sent.map((chunk) => chunk.toString("utf8"))).toEqual(["ab"]);
  });

  it("pauses on ack backpressure and resumes when acknowledged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const ws = new FakeOutputSocket();
    const transportSocket = new EventEmitter();
    const terminalManager = createTerminalManager();
    const streamState = { backpressuredViewerIds: new Set<string>() };
    const state = createTerminalIoOutputState({
      ws,
      streamState,
      clientId: "client-1",
      terminalId: "term-1",
      terminalManager,
      transportSocket: transportSocket as never,
      outputAckHighWaterMarkBytes: 3,
      outputAckLowWaterMarkBytes: 1,
      outputResumeCheckIntervalMs: 16,
    });

    state.enqueueOutput(Buffer.from("abcd"));

    expect(terminalManager.pause).toHaveBeenCalledWith("term-1");
    expect(streamState.backpressuredViewerIds.has("client-1")).toBe(true);

    state.acknowledgeOutput(4);

    expect(terminalManager.resume).toHaveBeenCalledWith("term-1");
    expect(streamState.backpressuredViewerIds.has("client-1")).toBe(false);
  });

  it("ignores impossible output acknowledgements", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const ws = new FakeOutputSocket();
    const terminalManager = createTerminalManager();
    const streamState = { backpressuredViewerIds: new Set<string>() };
    const state = createTerminalIoOutputState({
      ws,
      streamState,
      clientId: "client-1",
      terminalId: "term-1",
      terminalManager,
      outputAckHighWaterMarkBytes: 3,
      outputAckLowWaterMarkBytes: 1,
    });

    state.enqueueOutput(Buffer.from("abcd"));
    expect(streamState.backpressuredViewerIds.has("client-1")).toBe(true);

    state.acknowledgeOutput(Number.MAX_SAFE_INTEGER);

    expect(terminalManager.resume).not.toHaveBeenCalled();
    expect(streamState.backpressuredViewerIds.has("client-1")).toBe(true);

    state.acknowledgeOutput(4);

    expect(terminalManager.resume).toHaveBeenCalledWith("term-1");
    expect(streamState.backpressuredViewerIds.has("client-1")).toBe(false);
  });

  it("does not fast-path output while the terminal is paused for backpressure", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const ws = new FakeOutputSocket();
    const terminalManager = createTerminalManager();
    const state = createTerminalIoOutputState({
      ws,
      streamState: { backpressuredViewerIds: new Set<string>() },
      clientId: "client-1",
      terminalId: "term-1",
      terminalManager,
      outputAckHighWaterMarkBytes: 3,
      outputAckLowWaterMarkBytes: 1,
      lowLatencyIdleWindowMs: 5,
      outputBatchIntervalMs: 4,
    });

    state.enqueueOutput(Buffer.from("abcd"));
    vi.setSystemTime(20);
    state.enqueueOutput(Buffer.from("e"));

    expect(ws.sent.map((chunk) => chunk.toString("utf8"))).toEqual(["abcd"]);

    vi.advanceTimersByTime(4);

    expect(ws.sent.map((chunk) => chunk.toString("utf8"))).toEqual(["abcd", "e"]);
  });
});
