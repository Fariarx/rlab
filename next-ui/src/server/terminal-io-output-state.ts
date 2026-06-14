import type { Socket } from "node:net";

export interface TerminalOutputSocket {
  readonly OPEN: number;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(chunk: Buffer): void;
}

export interface TerminalOutputStreamBackpressureState {
  readonly backpressuredViewerIds: Set<string>;
}

export interface TerminalOutputFlowControl {
  pause(id: string): boolean;
  resume(id: string): boolean;
}

export interface TerminalIoOutputState {
  enqueueOutput: (chunk: Buffer) => void;
  acknowledgeOutput: (bytes: number) => void;
  dispose: () => void;
}

export interface TerminalIoOutputStateOptions {
  readonly ws: TerminalOutputSocket;
  readonly streamState: TerminalOutputStreamBackpressureState;
  readonly clientId: string;
  readonly terminalId: string;
  readonly terminalManager: TerminalOutputFlowControl;
  readonly transportSocket?: Socket | null;
  readonly outputBatchIntervalMs?: number;
  readonly lowLatencyChunkBytes?: number;
  readonly lowLatencyIdleWindowMs?: number;
  readonly outputBufferHighWaterMarkBytes?: number;
  readonly outputBufferLowWaterMarkBytes?: number;
  readonly outputAckHighWaterMarkBytes?: number;
  readonly outputAckLowWaterMarkBytes?: number;
  readonly outputResumeCheckIntervalMs?: number;
}

export const DEFAULT_OUTPUT_BATCH_INTERVAL_MS = 4;
export const DEFAULT_LOW_LATENCY_CHUNK_BYTES = 256;
export const DEFAULT_LOW_LATENCY_IDLE_WINDOW_MS = 5;
export const DEFAULT_OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES = 16 * 1024;
export const DEFAULT_OUTPUT_BUFFER_LOW_WATER_MARK_BYTES = 4 * 1024;
export const DEFAULT_OUTPUT_ACK_HIGH_WATER_MARK_BYTES = 100_000;
export const DEFAULT_OUTPUT_ACK_LOW_WATER_MARK_BYTES = 5_000;
export const DEFAULT_OUTPUT_RESUME_CHECK_INTERVAL_MS = 16;

export function createTerminalIoOutputState({
  ws,
  streamState,
  clientId,
  terminalId,
  terminalManager,
  transportSocket = null,
  outputBatchIntervalMs = DEFAULT_OUTPUT_BATCH_INTERVAL_MS,
  lowLatencyChunkBytes = DEFAULT_LOW_LATENCY_CHUNK_BYTES,
  lowLatencyIdleWindowMs = DEFAULT_LOW_LATENCY_IDLE_WINDOW_MS,
  outputBufferHighWaterMarkBytes = DEFAULT_OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES,
  outputBufferLowWaterMarkBytes = DEFAULT_OUTPUT_BUFFER_LOW_WATER_MARK_BYTES,
  outputAckHighWaterMarkBytes = DEFAULT_OUTPUT_ACK_HIGH_WATER_MARK_BYTES,
  outputAckLowWaterMarkBytes = DEFAULT_OUTPUT_ACK_LOW_WATER_MARK_BYTES,
  outputResumeCheckIntervalMs = DEFAULT_OUTPUT_RESUME_CHECK_INTERVAL_MS,
}: TerminalIoOutputStateOptions): TerminalIoOutputState {
  let pendingOutputChunks: Buffer[] = [];
  let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOutputSentAt = 0;
  let outputPaused = false;
  let resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let unacknowledgedOutputBytes = 0;

  const shouldPauseOutput = () => ws.bufferedAmount >= outputBufferHighWaterMarkBytes || unacknowledgedOutputBytes >= outputAckHighWaterMarkBytes;
  const canResumeOutput = () => ws.bufferedAmount < outputBufferLowWaterMarkBytes && unacknowledgedOutputBytes < outputAckLowWaterMarkBytes;

  const clearResumeCheck = () => {
    if (resumeCheckTimer !== null) {
      clearTimeout(resumeCheckTimer);
      resumeCheckTimer = null;
    }
    transportSocket?.removeListener("drain", checkResumeAfterBackpressure);
  };

  const scheduleResumeCheck = () => {
    if (!outputPaused) {
      return;
    }
    clearResumeCheck();
    transportSocket?.once("drain", checkResumeAfterBackpressure);
    resumeCheckTimer = setTimeout(() => {
      resumeCheckTimer = null;
      checkResumeAfterBackpressure();
    }, outputResumeCheckIntervalMs);
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
      if (pendingOutputChunks.length === 0 && outputFlushTimer === null && chunk.byteLength <= lowLatencyChunkBytes && now - lastOutputSentAt >= lowLatencyIdleWindowMs) {
        sendOutputChunk(chunk);
        return;
      }
      pendingOutputChunks.push(chunk);
      if (outputFlushTimer === null) {
        outputFlushTimer = setTimeout(flushOutputBatch, outputBatchIntervalMs);
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
