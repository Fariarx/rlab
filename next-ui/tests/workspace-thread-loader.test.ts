import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/components/agent";
import { WorkspaceThreadLoader, type WorkspaceThreadPage } from "../src/components/workspace/runtime/workspace-thread-loader";
import type { RemoteWorkspaceShellMerge } from "../src/components/workspace/models/workspace-server-sync-model";
import { buildEmptyWorkspaceState } from "../src/lib/workspace-state";

function userMessage(id: string): ChatMessage {
  return { id, role: "user", text: id, time: "12:00" };
}

function page(messages: readonly ChatMessage[], hasMoreBefore = false, nextBefore?: number): WorkspaceThreadPage {
  return { messages, hasMoreBefore, nextBefore };
}

function deferredPage() {
  let resolve!: (messages: WorkspaceThreadPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<WorkspaceThreadPage>((resolvePromise, rejectPromise) => {
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
    const pending = deferredPage();
    const loadConversationThreadPage = vi.fn(() => pending.promise);
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull: vi.fn(),
      loadConversationThreadPage,
      onLoadedOlderThread: vi.fn(),
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    const first = loader.loadThread("chat-1");
    const second = loader.loadThread("chat-1");

    expect(loadConversationThreadPage).toHaveBeenCalledTimes(1);
    pending.resolve(page([userMessage("u1")]));
    await Promise.all([first, second]);

    expect(onLoadedThread).toHaveBeenCalledTimes(1);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("u1")]);
  });

  it("skips already loaded shell threads unless a force load is requested", async () => {
    const loadConversationThreadPage = vi.fn(async (id: string) => page([userMessage(`${id}-loaded`)]));
    const loadConversationThreadFull = vi.fn(async (id: string) => [userMessage(`${id}-full`)]);
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull,
      loadConversationThreadPage,
      onLoadedOlderThread: vi.fn(),
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    loader.resetLoadedThreads(["chat-1"]);
    expect(loader.isLoaded("chat-1")).toBe(true);
    expect(loader.isLoaded("chat-2")).toBe(false);

    await loader.loadThread("chat-1");

    expect(loadConversationThreadPage).not.toHaveBeenCalled();
    expect(loadConversationThreadFull).not.toHaveBeenCalled();

    await loader.loadThread("chat-1", true);

    expect(loadConversationThreadPage).not.toHaveBeenCalled();
    expect(loadConversationThreadFull).toHaveBeenCalledTimes(1);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("chat-1-full")]);
  });

  it("reconciles loaded and in-flight tracking after a remote shell merge", async () => {
    const loadConversationThreadPage = vi.fn(async (id: string) => page([userMessage(`${id}-loaded`)]));
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull: vi.fn(),
      loadConversationThreadPage,
      onLoadedOlderThread: vi.fn(),
      onLoadedThread: vi.fn(),
      onLoadError: vi.fn(),
    });

    loader.resetLoadedThreads(["removed"]);
    loader.reconcileRemoteShell(remoteMerge(["chat-1", "chat-2"], ["chat-2"]));

    await loader.loadThread("chat-2");
    await loader.loadThread("removed");

    expect(loadConversationThreadPage).toHaveBeenCalledTimes(1);
    expect(loadConversationThreadPage).toHaveBeenCalledWith("removed");
  });

  it("reports load errors and allows a later retry", async () => {
    const loadConversationThreadPage = vi
      .fn<(id: string) => Promise<WorkspaceThreadPage>>()
      .mockRejectedValueOnce(new Error("thread unavailable"))
      .mockResolvedValueOnce(page([userMessage("u1")]));
    const onLoadError = vi.fn();
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull: vi.fn(),
      loadConversationThreadPage,
      onLoadedOlderThread: vi.fn(),
      onLoadedThread,
      onLoadError,
    });

    await loader.loadThread("chat-1");
    await loader.loadThread("chat-1");

    expect(onLoadError).toHaveBeenCalledWith("thread unavailable");
    expect(loadConversationThreadPage).toHaveBeenCalledTimes(2);
    expect(onLoadedThread).toHaveBeenCalledWith("chat-1", [userMessage("u1")]);
  });

  it("loads older pages using the server cursor", async () => {
    const loadConversationThreadPage = vi
      .fn<(id: string, before?: number) => Promise<WorkspaceThreadPage>>()
      .mockResolvedValueOnce(page([userMessage("new")], true, 10))
      .mockResolvedValueOnce(page([userMessage("old")], false, 5));
    const onLoadedThread = vi.fn();
    const onLoadedOlderThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull: vi.fn(),
      loadConversationThreadPage,
      onLoadedOlderThread,
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    await loader.loadThread("chat-1");
    expect(loader.hasOlderMessages("chat-1")).toBe(true);

    await loader.loadOlderThread("chat-1");

    expect(loadConversationThreadPage).toHaveBeenNthCalledWith(2, "chat-1", 10);
    expect(onLoadedOlderThread).toHaveBeenCalledWith("chat-1", [userMessage("old")]);
    expect(loader.hasOlderMessages("chat-1")).toBe(false);
    expect(loader.isFullyLoaded("chat-1")).toBe(true);
  });

  it("loads full threads separately from the visible page", async () => {
    const loadConversationThreadFull = vi.fn(async (id: string) => [userMessage(`${id}-full`)]);
    const onLoadedThread = vi.fn();
    const loader = new WorkspaceThreadLoader({
      loadConversationThreadFull,
      loadConversationThreadPage: vi.fn(async (id: string) => page([userMessage(`${id}-page`)], true, 1)),
      onLoadedOlderThread: vi.fn(),
      onLoadedThread,
      onLoadError: vi.fn(),
    });

    await loader.loadThread("chat-1");
    expect(loader.isLoaded("chat-1")).toBe(true);
    expect(loader.isFullyLoaded("chat-1")).toBe(false);

    await loader.loadFullThread("chat-1");

    expect(loadConversationThreadFull).toHaveBeenCalledWith("chat-1");
    expect(onLoadedThread).toHaveBeenLastCalledWith("chat-1", [userMessage("chat-1-full")]);
    expect(loader.isFullyLoaded("chat-1")).toBe(true);
  });
});
