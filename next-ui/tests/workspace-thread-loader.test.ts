import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/components/agent";
import { WorkspaceThreadLoader } from "../src/components/workspace/runtime/workspace-thread-loader";
import type { RemoteWorkspaceShellMerge } from "../src/components/workspace/models/workspace-server-sync-model";
import { buildEmptyWorkspaceState } from "../src/lib/workspace-state";

function userMessage(id: string): ChatMessage {
  return { id, role: "user", text: id, time: "12:00" };
}

function deferredMessages() {
  let resolve!: (messages: readonly ChatMessage[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<readonly ChatMessage[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function remoteMerge(knownConversationIds: readonly string[], shellThreadIds: readonly string[]): RemoteWorkspaceShellMerge {
  return {
    state: buildEmptyWorkspaceState(),
    selectedId: knownConversationIds[0] ?? "",
    knownConversationIds: new Set(knownConversationIds),
    shellThreadIds: new Set(shellThreadIds),
  };
}

describe("WorkspaceThreadLoader", () => {
  it("dedupes concurrent loads for the same conversation", async () => {
    const pending = deferredMessages();
    const loadConversationThread = vi.fn(() => pending.promise);
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThread,
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    const first = loader.loadThread("chat-1");
    const second = loader.loadThread("chat-1");

    expect(loadConversationThread).toHaveBeenCalledTimes(1);
    pending.resolve([userMessage("u1")]);
    await Promise.all([first, second]);

    expect(onLoadedThread).toHaveBeenCalledTimes(1);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("u1")]);
  });

  it("skips already loaded shell threads unless a force load is requested", async () => {
    const loadConversationThread = vi.fn(async (id: string) => [userMessage(`${id}-loaded`)]);
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThread,
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    loader.resetLoadedThreads(["chat-1"]);
    await loader.loadThread("chat-1");

    expect(loadConversationThread).not.toHaveBeenCalled();

    await loader.loadThread("chat-1", true);

    expect(loadConversationThread).toHaveBeenCalledTimes(1);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("chat-1-loaded")]);
  });

  it("reconciles loaded and in-flight tracking after a remote shell merge", async () => {
    const loadConversationThread = vi.fn(async (id: string) => [userMessage(`${id}-loaded`)]);
    const loader = new WorkspaceThreadLoader({
      loadConversationThread,
      onLoadedThread: vi.fn(),
      onLoadError: vi.fn(),
    });

    loader.resetLoadedThreads(["removed"]);
    loader.reconcileRemoteShell(remoteMerge(["chat-1", "chat-2"], ["chat-2"]));

    await loader.loadThread("chat-2");
    await loader.loadThread("removed");

    expect(loadConversationThread).toHaveBeenCalledTimes(1);
    expect(loadConversationThread).toHaveBeenCalledWith("removed");
  });

  it("reports load errors and allows a later retry", async () => {
    const loadConversationThread = vi
      .fn<(id: string) => Promise<readonly ChatMessage[]>>()
      .mockRejectedValueOnce(new Error("thread unavailable"))
      .mockResolvedValueOnce([userMessage("u1")]);
    const onLoadError = vi.fn();
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThread,
      onLoadedThread,
      onLoadError,
    });

    await loader.loadThread("chat-1");
    await loader.loadThread("chat-1");

    expect(onLoadError).toHaveBeenCalledWith("thread unavailable");
    expect(loadConversationThread).toHaveBeenCalledTimes(2);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("u1")]);
  });
});
