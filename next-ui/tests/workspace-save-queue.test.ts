import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../src/lib/workspace-state";
import { buildInitialWorkspaceState } from "../src/lib/workspace-state";
import type { WorkspaceMutation } from "../src/lib/workspace-mutations";
import { WorkspaceSaveQueue, type WorkspaceSaveQueueHost } from "../src/components/workspace/runtime/workspace-save-queue";

function hostFor(stateRef: { current: WorkspaceState }, revisionRef: { current: number }): WorkspaceSaveQueueHost {
  return {
    activeRuns: new Map(),
    applyServerState: (state) => {
      stateRef.current = state;
    },
    getLoadError: () => null,
    getRevision: () => revisionRef.current,
    getState: () => stateRef.current,
    setLoadError: vi.fn(),
    setRevision: (revision) => {
      revisionRef.current = revision;
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("WorkspaceSaveQueue", () => {
  let mutationRequests: Array<{ readonly baseRevision: number; readonly mutations: readonly WorkspaceMutation[] }>;

  beforeEach(() => {
    vi.useFakeTimers();
    mutationRequests = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces queued mutations and updates the saved revision", async () => {
    const stateRef = { current: buildInitialWorkspaceState() };
    const revisionRef = { current: 3 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        mutationRequests.push(JSON.parse(String(init?.body ?? "{}")) as { baseRevision: number; mutations: WorkspaceMutation[] });
        return Response.json({ ok: true, revision: 4 });
      }),
    );
    const queue = new WorkspaceSaveQueue(hostFor(stateRef, revisionRef));
    const mutation: WorkspaceMutation = { type: "setSelectedConversation", conversationId: "chat-1" };

    queue.enqueue(mutation);

    expect(mutationRequests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(mutationRequests).toEqual([{ baseRevision: 3, mutations: [mutation] }]);
    expect(revisionRef.current).toBe(4);
  });

  it("rebases unsaved mutations after a revision conflict and retries them", async () => {
    const stateRef = { current: buildInitialWorkspaceState() };
    const revisionRef = { current: 3 };
    const serverState = buildInitialWorkspaceState();
    const firstMutation: WorkspaceMutation = { type: "setSelectedConversation", conversationId: "chat-1" };
    const secondMutation: WorkspaceMutation = { type: "setSettings", settings: stateRef.current.settings };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        mutationRequests.push(JSON.parse(String(init?.body ?? "{}")) as { baseRevision: number; mutations: WorkspaceMutation[] });
        if (mutationRequests.length === 1) {
          return Response.json({ error: "conflict", revision: 7, workspace: serverState }, { status: 409 });
        }
        return Response.json({ ok: true, revision: 8 });
      }),
    );
    const queue = new WorkspaceSaveQueue(hostFor(stateRef, revisionRef));

    queue.enqueue(firstMutation);
    await vi.advanceTimersByTimeAsync(250);
    queue.enqueue(secondMutation);
    await flushMicrotasks();

    expect(revisionRef.current).toBe(7);
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    expect(mutationRequests[1]).toEqual({ baseRevision: 7, mutations: [firstMutation, secondMutation] });
    expect(revisionRef.current).toBe(8);
  });
});
