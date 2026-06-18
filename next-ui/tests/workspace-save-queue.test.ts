import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../src/lib/workspace-state";
import { buildInitialWorkspaceState } from "../src/lib/workspace-state";
import type { WorkspaceMutation } from "../src/lib/workspace-mutations";
import { WorkspaceSaveQueue, type WorkspaceSaveQueueHost } from "../src/components/workspace/runtime/workspace-save-queue";
import type { RemoteWorkspaceShellMerge } from "../src/components/workspace/models/workspace-server-sync-model";
import type { ChatMessage, ConversationSummary } from "../src/domain/agent-types";

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

  it("preserves loaded threads when rebasing against a shell-only conflict workspace", async () => {
    const original = buildInitialWorkspaceState();
    const selectedId = original.selectedId;
    const fullThread = original.threads[selectedId] ?? [];
    const userMessage: ChatMessage = { id: "u-local", role: "user", text: "local turn", time: "12:00" };
    const stateRef = {
      current: {
        ...original,
        threads: {
          ...original.threads,
          [selectedId]: [...fullThread, userMessage],
        },
      },
    };
    const revisionRef = { current: 3 };
    const shellOnlyServerState: WorkspaceState = { ...original, threads: {} };
    const firstMutation: WorkspaceMutation = { type: "upsertMessage", conversationId: selectedId, message: userMessage };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        mutationRequests.push(JSON.parse(String(init?.body ?? "{}")) as { baseRevision: number; mutations: WorkspaceMutation[] });
        if (mutationRequests.length === 1) {
          return Response.json({ error: "conflict", revision: 7, workspace: shellOnlyServerState }, { status: 409 });
        }
        return Response.json({ ok: true, revision: 8 });
      }),
    );
    const queue = new WorkspaceSaveQueue(hostFor(stateRef, revisionRef));

    queue.enqueue(firstMutation);
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(stateRef.current.threads[selectedId]?.map((message) => message.id)).toEqual([...fullThread.map((message) => message.id), userMessage.id]);
    expect(revisionRef.current).toBe(7);
  });

  it("keeps a locally created empty conversation known after conflict rebase", async () => {
    const serverState = buildInitialWorkspaceState();
    const newConversation: ConversationSummary = {
      id: "chat-local-new",
      title: "New chat",
      snippet: "",
      time: "12:00",
      status: "idle",
      agent: "codex",
      profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
    };
    const stateRef = {
      current: {
        ...serverState,
        chats: [newConversation, ...serverState.chats],
        threads: { ...serverState.threads, [newConversation.id]: [] },
        selectedId: newConversation.id,
      },
    };
    const revisionRef = { current: 3 };
    const rebasedMerge: { current: RemoteWorkspaceShellMerge | null } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        mutationRequests.push(JSON.parse(String(init?.body ?? "{}")) as { baseRevision: number; mutations: WorkspaceMutation[] });
        if (mutationRequests.length === 1) {
          return Response.json({ error: "conflict", revision: 7, workspace: { ...serverState, threads: {} } }, { status: 409 });
        }
        return Response.json({ ok: true, revision: 8 });
      }),
    );
    const host = {
      ...hostFor(stateRef, revisionRef),
      applyRemoteMergedState: (state, merge) => {
        stateRef.current = state;
        rebasedMerge.current = merge;
      },
    } satisfies WorkspaceSaveQueueHost;
    const queue = new WorkspaceSaveQueue(host);

    queue.enqueue(
      { type: "upsertConversation", conversation: newConversation, projectId: null, insertAtFront: true },
      { type: "upsertMessages", conversationId: newConversation.id, messages: [] },
      { type: "setSelectedConversation", conversationId: newConversation.id },
    );
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    const merge = rebasedMerge.current as RemoteWorkspaceShellMerge;
    expect(merge.knownConversationIds.has(newConversation.id)).toBe(true);
    expect(stateRef.current.selectedId).toBe(newConversation.id);
    expect(stateRef.current.threads[newConversation.id]).toEqual([]);
    expect(revisionRef.current).toBe(7);
  });
});
