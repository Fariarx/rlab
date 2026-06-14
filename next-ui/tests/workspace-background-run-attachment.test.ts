import { afterEach, describe, expect, it, vi } from "vitest";
import type { attachRunUpdates, loadActiveRuns, ActiveRunSnapshot, ActiveRunUpdate } from "../src/client/api/run-agent";
import { attachWorkspaceBackgroundRun, type RunHandle } from "../src/components/workspace/runtime/workspace-background-run-attachment";

function activeRun(patch: Partial<ActiveRunSnapshot> = {}): ActiveRunSnapshot {
  return {
    runId: patch.runId ?? "run-1",
    conversationId: patch.conversationId ?? "chat-1",
    userMessageId: patch.userMessageId ?? "u1",
    agentMessageId: patch.agentMessageId ?? "a1",
    startedAt: patch.startedAt ?? "2026-06-14T00:00:00.000Z",
  };
}

function activeUpdate(patch: Partial<ActiveRunUpdate> = {}): ActiveRunUpdate {
  return {
    runId: patch.runId ?? "run-1",
    conversationId: patch.conversationId ?? "chat-1",
    userMessageId: patch.userMessageId ?? "u1",
    agentMessageId: patch.agentMessageId ?? "a1",
    status: patch.status ?? "running",
    time: patch.time ?? "12:00",
    done: patch.done ?? false,
    blocks: patch.blocks ?? [],
    costUsd: patch.costUsd,
    usage: patch.usage,
    startedAtMs: patch.startedAtMs,
  };
}

async function flushAttachPromise(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("workspace-background-run-attachment", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies streamed updates and clears the handle after a terminal update", async () => {
    const runs = new Map<string, RunHandle>();
    const update = activeUpdate({ done: true, status: "done" });
    const applyUpdate = vi.fn();
    const setLoadError = vi.fn();
    const reconcileBackgroundRuns = vi.fn();
    const attachRunUpdatesApi: typeof attachRunUpdates = vi.fn(({ onUpdate }) => {
      onUpdate(update);
      return Promise.resolve();
    });

    attachWorkspaceBackgroundRun({
      run: activeRun(),
      runs,
      applyUpdate,
      disconnectedMessage: () => "disconnected",
      reconcileBackgroundRuns,
      setLoadError,
      attachRunUpdatesApi,
    });
    await flushAttachPromise();

    expect(attachRunUpdatesApi).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(applyUpdate).toHaveBeenCalledWith(update);
    expect(setLoadError).not.toHaveBeenCalled();
    expect(reconcileBackgroundRuns).not.toHaveBeenCalled();
    expect(runs.has("chat-1")).toBe(false);
  });

  it("reports a disconnected attach stream when no terminal update arrived", async () => {
    const runs = new Map<string, RunHandle>();
    const setLoadError = vi.fn();
    const reconcileBackgroundRuns = vi.fn();
    const attachRunUpdatesApi: typeof attachRunUpdates = vi.fn(() => Promise.resolve());

    attachWorkspaceBackgroundRun({
      run: activeRun(),
      runs,
      applyUpdate: vi.fn(),
      disconnectedMessage: () => "stream disconnected",
      reconcileBackgroundRuns,
      setLoadError,
      attachRunUpdatesApi,
    });
    await flushAttachPromise();

    expect(setLoadError).toHaveBeenCalledWith("stream disconnected");
    expect(reconcileBackgroundRuns).toHaveBeenCalledTimes(1);
    expect(runs.has("chat-1")).toBe(false);
  });

  it("reconciles a silent attach when the server no longer lists the run", async () => {
    vi.useFakeTimers();
    const runs = new Map<string, RunHandle>();
    const reconcileBackgroundRuns = vi.fn();
    let attachedSignal: AbortSignal | undefined;
    const attachRunUpdatesApi: typeof attachRunUpdates = vi.fn((opts) => {
      attachedSignal = opts.signal;
      return new Promise<void>(() => undefined);
    });
    const loadActiveRunsApi: typeof loadActiveRuns = vi.fn().mockResolvedValue([]);

    attachWorkspaceBackgroundRun({
      run: activeRun(),
      runs,
      applyUpdate: vi.fn(),
      disconnectedMessage: () => "disconnected",
      reconcileBackgroundRuns,
      setLoadError: vi.fn(),
      silenceReconcileMs: 5,
      attachRunUpdatesApi,
      loadActiveRunsApi,
    });

    expect(runs.has("chat-1")).toBe(true);
    vi.advanceTimersByTime(5);
    await Promise.resolve();

    expect(loadActiveRunsApi).toHaveBeenCalledTimes(1);
    expect(runs.has("chat-1")).toBe(false);
    expect(attachedSignal?.aborted).toBe(true);
    expect(reconcileBackgroundRuns).toHaveBeenCalledTimes(1);
  });
});
