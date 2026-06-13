import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observer } from "mobx-react-lite";
import { useWorkspace } from "../src/components/workspace/use-workspace";
import { buildInitialWorkspaceState, type WorkspaceState } from "../src/components/workspace/workspace-state";
import { applyWorkspaceMutationsToState, type WorkspaceMutation } from "../src/lib/workspace-mutations";

const WORKSPACE_SYNC_TICK_MS = 2_000;

const Probe = observer(function Probe() {
  const workspace = useWorkspace();
  const selected = workspace.find(workspace.selectedId);
  return (
    <div>
      <div data-testid="selected">{workspace.selectedId}</div>
      <div data-testid="selected-title">{selected?.title ?? "none"}</div>
      <div data-testid="status">{selected?.status}</div>
      <div data-testid="theme">{workspace.settings.appearance.theme}</div>
      <div data-testid="locale">{workspace.settings.general.locale}</div>
      <div data-testid="density">{workspace.settings.appearance.density}</div>
      <div data-testid="loading">{String(workspace.loading)}</div>
      <div data-testid="error">{workspace.loadError ?? "none"}</div>
      <div data-testid="cost">{selected?.costUsd ?? "none"}</div>
      <div data-testid="usage">{selected?.usage?.totalTokens ?? "none"}</div>
      <div data-testid="context-usage">{selected?.usage?.contextTokens ?? "none"}</div>
      <div data-testid="queued">{workspace.pendingMessageCount(workspace.selectedId)}</div>
      <div data-testid="archived">{[...workspace.chats, ...workspace.projects.flatMap((project) => project.conversations)].filter((conversation) => conversation.archived).map((conversation) => conversation.id).join(",")}</div>
      <div data-testid="thread-ids">{(workspace.threads[workspace.selectedId] ?? []).map((message) => message.id).join(",")}</div>
      <div data-testid="agent-blocks">{JSON.stringify((workspace.threads[workspace.selectedId] ?? []).filter((message) => message.role === "agent").map((message) => message.blocks ?? []))}</div>
      <button type="button" onClick={() => workspace.sendMessage(workspace.selectedId, "Persist this message")}>
        send
      </button>
      <button type="button" onClick={() => workspace.setConversationProfile(workspace.selectedId, { agent: "claude-code", model: "default", reasoning: "default", mode: "default" })}>
        agent-claude
      </button>
      <button type="button" onClick={() => workspace.setConversationProfile(workspace.selectedId, { agent: "codex", model: "default", reasoning: "default", mode: "default" })}>
        agent-codex
      </button>
      <button type="button" onClick={() => workspace.setConversationProfile(workspace.selectedId, { agent: "gemini", model: "default", reasoning: "default", mode: "default" })}>
        agent-gemini
      </button>
      <button type="button" onClick={() => workspace.setConversationProfile(workspace.selectedId, { agent: "opencode", model: "default", reasoning: "default", mode: "default" })}>
        agent-opencode
      </button>
      <button type="button" onClick={() => workspace.updateComposerDraft(workspace.selectedId, { text: "a", attachments: [] })}>
        draft-a
      </button>
      <button type="button" onClick={() => workspace.updateComposerDraft(workspace.selectedId, { text: "ab", attachments: [] })}>
        draft-ab
      </button>
      <button type="button" onClick={() => workspace.stopRun(workspace.selectedId)}>
        stop
      </button>
      <button type="button" onClick={() => workspace.sendQueuedMessageNow(workspace.selectedId)}>
        send-queued-now
      </button>
      <button type="button" onClick={() => workspace.remove("chat-1")}>
        remove-chat-1
      </button>
      <button type="button" onClick={() => workspace.remove(workspace.selectedId)}>
        remove-selected
      </button>
      <button type="button" onClick={() => workspace.archive("chat-1")}>
        archive-chat-1
      </button>
      <button type="button" onClick={() => workspace.compactConversation(workspace.selectedId)}>
        compact
      </button>
      <button type="button" onClick={() => workspace.retryMessage(workspace.selectedId, "u1")}>
        retry
      </button>
      <button type="button" onClick={() => workspace.forkConversationFromMessage(workspace.selectedId, "a1")}>
        fork-a1
      </button>
      <button type="button" onClick={() => workspace.editAndResendMessage(workspace.selectedId, "u1", "Edited resend text")}>
        edit-resend
      </button>
      <button type="button" onClick={() => workspace.decideApproval(workspace.selectedId, "approval-1", "approved")}>
        approve
      </button>
      <button type="button" onClick={() => workspace.newProjectChat("auth-service", { agent: "claude-code", model: "default", reasoning: "default", mode: "default" })}>
        new-project-chat
      </button>
      <button type="button" onClick={() => workspace.createProject({ name: "billing", path: "C:\\work\\billing", profile: { agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" } })}>
        create-project
      </button>
      <button
        type="button"
        onClick={() =>
          workspace.updateSettings({
            appearance: { density: "compact", reduceMotion: true, sidebarWidth: 360, theme: "light" },
            general: { locale: "en" },
          })
        }
      >
        update-settings
      </button>
    </div>
  );
});

function activeRunsPayloadFromState(state: WorkspaceState) {
  return {
    runs: [...state.chats, ...state.projects.flatMap((project) => project.conversations)].flatMap((conversation) =>
      conversation.activeRunId
        ? [
            {
              runId: conversation.activeRunId,
              conversationId: conversation.id,
              userMessageId: "test-user-message",
              agentMessageId: "test-agent-message",
              startedAt: "2026-06-06T14:00:00.000Z",
            },
          ]
        : [],
    ),
  };
}

interface RunRequestRecord {
  readonly accessMode?: string;
  readonly agent?: string;
  readonly agentMessageId?: string;
  readonly conversationId?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly resume?: string;
  readonly runId?: string;
  readonly userMessageId?: string;
  readonly mode?: string;
}

function applyWorkspaceMutationRequest(state: WorkspaceState, init: RequestInit | undefined): WorkspaceState {
  const payload = JSON.parse(String(init?.body ?? "{}")) as { mutations?: WorkspaceMutation[] };
  return applyWorkspaceMutationsToState(state, payload.mutations ?? []);
}

describe("useWorkspace", () => {
  let state: WorkspaceState;
  let localStorageSetItem: ReturnType<typeof vi.fn>;
  let originalLocalStorage: PropertyDescriptor | undefined;
  let activeRunSignal: AbortSignal | undefined;
  let activeRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let attachRunSignal: AbortSignal | undefined;
  let attachRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let attachRunRequests: string[] = [];
  let runRequests: RunRequestRecord[] = [];
  let runCancelRequests: Array<{ readonly runId?: string }> = [];
  let serverRevision = 1;

  beforeEach(() => {
    state = buildInitialWorkspaceState();
    serverRevision = 1;
    attachRunRequests = [];
    runRequests = [];
    runCancelRequests = [];
    originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    localStorageSetItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: localStorageSetItem,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json({ ...state, revision: serverRevision });
        }
        if (url === "/api/workspace/revision" && (!init || init.method === "GET")) {
          return Response.json({ revision: serverRevision });
        }
        if (url === "/api/workspace/mutations" && init?.method === "POST") {
          state = applyWorkspaceMutationRequest(state, init);
          serverRevision += 1;
          return Response.json({ ok: true, revision: serverRevision });
        }
        if (url.startsWith("/api/thread?")) {
          const conversationId = new URL(url, "http://localhost").searchParams.get("conversationId") ?? "";
          return Response.json({ messages: state.threads[conversationId] ?? [] });
        }
        if (url === "/api/runs") {
          return Response.json(activeRunsPayloadFromState(state));
        }
        if (url.startsWith("/api/run-attach")) {
          attachRunRequests.push(url);
          attachRunSignal = init?.signal as AbortSignal | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              attachRunController = controller;
            },
          });
          return new Response(stream, {
            headers: { "Content-Type": "application/x-ndjson" },
          });
        }
        if (url === "/api/run") {
          runRequests.push(JSON.parse(String(init?.body ?? "{}")) as RunRequestRecord);
          activeRunSignal = init?.signal as AbortSignal | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              activeRunController = controller;
              controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "text", text: "ok" })}\n`));
              activeRunSignal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
            },
          });
          return new Response(stream, {
            headers: { "Content-Type": "application/x-ndjson" },
          });
        }
        if (url === "/api/run-cancel") {
          runCancelRequests.push(JSON.parse(String(init?.body ?? "{}")) as { runId?: string });
          return Response.json({ canceled: true });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }
  });

  it("loads workspace state from the server API", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");

    expect(fetch).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "GET" }));
  });

  it("does not save freshly loaded server workspace state back to the workspace API", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST")).toHaveLength(0);
  });

  it("syncs remote workspace updates without stealing the local selected conversation", async () => {
    vi.useFakeTimers();
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("chat-2");

    state = {
      ...state,
      selectedId: "chat-1",
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, title: "Remote title" } : chat)),
    };
    serverRevision += 1;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKSPACE_SYNC_TICK_MS);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("selected")).toHaveTextContent("chat-2");
    expect(screen.getByTestId("selected-title")).toHaveTextContent("Remote title");
  });

  it("refreshes the locally selected thread when the remote shell omits it", async () => {
    vi.useFakeTimers();
    let remoteShellMode = false;
    const remoteMessage = {
      id: "a-remote-sync",
      role: "agent",
      time: "16:00",
      blocks: [{ kind: "text", text: "Remote answer" }],
    } satisfies WorkspaceState["threads"][string][number];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        if (remoteShellMode) {
          return Response.json({ ...state, selectedId: "chat-1", threads: { "chat-1": state.threads["chat-1"] ?? [] }, revision: serverRevision });
        }
        return Response.json({ ...state, revision: serverRevision });
      }
      if (url === "/api/workspace/revision" && (!init || init.method === "GET")) {
        return Response.json({ revision: serverRevision });
      }
      if (url.startsWith("/api/thread?")) {
        const conversationId = new URL(url, "http://localhost").searchParams.get("conversationId") ?? "";
        return Response.json({ messages: state.threads[conversationId] ?? [] });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      return new Response("not found", { status: 404 });
    });
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("chat-2");

    state = {
      ...state,
      selectedId: "chat-1",
      threads: {
        ...state.threads,
        "chat-2": [...state.threads["chat-2"], remoteMessage],
      },
    };
    remoteShellMode = true;
    serverRevision += 1;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKSPACE_SYNC_TICK_MS);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("selected")).toHaveTextContent("chat-2");
    expect(screen.getByTestId("thread-ids")).toHaveTextContent("a-remote-sync");
  });

  it("retries failed initial workspace loads every 15 seconds", async () => {
    vi.useFakeTimers();
    let workspaceReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        workspaceReads += 1;
        if (workspaceReads === 1) {
          throw new TypeError("Failed to fetch");
        }
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("error")).toHaveTextContent("Failed to fetch");
    expect(workspaceReads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(workspaceReads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByText("chat-2")).toBeInTheDocument();
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(workspaceReads).toBe(2);
  });

  it("persists thread changes to the server instead of localStorage", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/workspace/mutations", expect.objectContaining({ method: "POST" }));
    });
    expect(state.threads["chat-2"].some((message) => message.text === "Persist this message")).toBe(true);
    expect(localStorageSetItem).not.toHaveBeenCalledWith(expect.stringContaining("rlab-workspace"), expect.any(String));
  });

  it("persists conversation deletion without resending unchanged loaded threads", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    const savesBefore = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;
    screen.getByRole("button", { name: "remove-chat-1" }).click();

    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST");
      expect(saves).toHaveLength(savesBefore + 1);
    });
    const saves = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST");
    const payload = JSON.parse(String(saves.at(-1)?.[1]?.body ?? "{}")) as { mutations?: WorkspaceMutation[] };
    expect(payload.mutations).toContainEqual({ type: "deleteConversation", conversationId: "chat-1" });
    expect(payload.mutations?.some((mutation) => mutation.type === "replaceConversationThread")).toBe(false);
    expect(state.chats.some((chat) => chat.id === "chat-1")).toBe(false);
  });

  it("moves selection to an existing conversation after deleting the selected conversation", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "remove-selected" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("selected")).not.toHaveTextContent("chat-2");
    });
    const selectedId = screen.getByTestId("selected").textContent ?? "";
    const conversations = [...state.chats, ...state.projects.flatMap((project) => project.conversations)];
    expect(selectedId).not.toBe("");
    expect(conversations.some((conversation) => conversation.id === selectedId)).toBe(true);
    expect(state.chats.some((chat) => chat.id === "chat-2")).toBe(false);
    expect(state.threads["chat-2"]).toBeUndefined();
  });

  it("archives conversations without deleting their thread", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    const originalThread = state.threads["chat-1"];
    const savesBefore = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;
    screen.getByRole("button", { name: "archive-chat-1" }).click();

    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST");
      expect(saves).toHaveLength(savesBefore + 1);
    });

    expect(screen.getByTestId("archived")).toHaveTextContent("chat-1");
    expect(state.chats.find((chat) => chat.id === "chat-1")?.archived).toBe(true);
    expect(state.threads["chat-1"]).toEqual(originalThread);
  });

  it("unarchives an archived conversation when the user sends a message", async () => {
    state = {
      ...state,
      selectedId: "chat-1",
      chats: state.chats.map((chat) => (chat.id === "chat-1" ? { ...chat, archived: true } : chat)),
    };

    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("chat-1"));
    expect(screen.getByTestId("archived")).toHaveTextContent("chat-1");

    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("archived")).not.toHaveTextContent("chat-1");
    });
    expect(state.chats.find((chat) => chat.id === "chat-1")?.archived).toBe(false);
    expect(state.threads["chat-1"].some((message) => message.text === "Persist this message")).toBe(true);
  });

  it("generates fresh ids without reusing persisted workspace ids", async () => {
    state = {
      ...state,
      chats: [{ ...state.chats[0], id: "chat-5000" }, ...state.chats.slice(1)],
      selectedId: "chat-2",
      threads: {
        ...state.threads,
        "chat-2": [{ id: "u-5000", role: "user", text: "Persisted user message" }],
      },
    };

    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests).toHaveLength(1);
    });
    expect(runRequests[0]?.userMessageId).toMatch(/^u-/);
    expect(runRequests[0]?.runId).toMatch(/^run-/);
    expect(runRequests[0]?.agentMessageId).toMatch(/^a-/);
    expect(runRequests[0]?.userMessageId).not.toBe("u-5000");
    expect(runRequests[0]?.runId).not.toBe("run-5000");
    expect(runRequests[0]?.agentMessageId).not.toBe("a-5000");

    const ids = state.threads["chat-2"].map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("coalesces rapid draft changes into one delayed workspace save", async () => {
    vi.useFakeTimers();
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();
    const savesBefore = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;

    await act(async () => {
      screen.getByRole("button", { name: "draft-a" }).click();
      screen.getByRole("button", { name: "draft-ab" }).click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST")).toHaveLength(savesBefore);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const savesAfter = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST");
    expect(savesAfter).toHaveLength(savesBefore + 1);
    expect(state.composerDrafts["chat-2"]?.text).toBe("ab");
    expect(localStorageSetItem).not.toHaveBeenCalledWith(expect.stringContaining("rlab-workspace"), expect.any(String));
  });

  it("retries transient workspace save failures and clears the save error after success", async () => {
    vi.useFakeTimers();
    let saveAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return Response.json({ error: "database is locked" }, { status: 502 });
        }
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "draft-a" }).click();
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(saveAttempts).toBe(1);
    expect(screen.getByTestId("error")).toHaveTextContent("Workspace save failed: database is locked");
    expect(state.composerDrafts["chat-2"]?.text).not.toBe("a");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(saveAttempts).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(saveAttempts).toBe(2);
    expect(state.composerDrafts["chat-2"]?.text).toBe("a");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("rebases pending workspace mutations after a revision conflict", async () => {
    vi.useFakeTimers();
    let serverRevision = 7;
    let saveAttempts = 0;
    const baseRevisions: number[] = [];

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json({ ...state, revision: serverRevision });
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        saveAttempts += 1;
        const payload = JSON.parse(String(init.body ?? "{}")) as { readonly baseRevision?: number; readonly mutations?: readonly WorkspaceMutation[] };
        baseRevisions.push(payload.baseRevision ?? -1);
        if (saveAttempts === 1) {
          const remoteConversation = state.chats.find((chat) => chat.id === "chat-2");
          if (!remoteConversation) {
            throw new Error("Missing chat-2 fixture.");
          }
          state = applyWorkspaceMutationsToState(state, [{ type: "updateConversation", conversation: { ...remoteConversation, title: "Remote title" } }]);
          serverRevision = 8;
          return Response.json(
            {
              error: "Workspace revision conflict: expected 7, current 8.",
              code: "workspace_revision_conflict",
              expectedRevision: 7,
              revision: serverRevision,
              workspace: state,
            },
            { status: 409 },
          );
        }
        state = applyWorkspaceMutationRequest(state, init);
        serverRevision = 9;
        return Response.json({ ok: true, revision: serverRevision });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "draft-a" }).click();
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(saveAttempts).toBe(1);
    expect(screen.getByTestId("selected-title")).toHaveTextContent("Remote title");
    expect(state.composerDrafts["chat-2"]).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(saveAttempts).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(saveAttempts).toBe(2);
    expect(state.composerDrafts["chat-2"]?.text).toBe("a");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(baseRevisions).toEqual([7, 8]);
    expect(serverRevision).toBe(9);
  });

  it("does not clear live agent reasoning when a stale initial message save conflicts", async () => {
    vi.useFakeTimers();
    let serverRevision = 3;
    let saveAttempts = 0;
    let resolveFirstSave: (() => void) | null = null;
    const mutationPayloads: Array<{ readonly baseRevision?: number; readonly mutations?: readonly WorkspaceMutation[] }> = [];

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json({ ...state, revision: serverRevision });
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        saveAttempts += 1;
        const payload = JSON.parse(String(init.body ?? "{}")) as { readonly baseRevision?: number; readonly mutations?: readonly WorkspaceMutation[] };
        mutationPayloads.push(payload);
        if (saveAttempts === 1) {
          return await new Promise<Response>((resolve) => {
            resolveFirstSave = () => {
              const remoteConversation = state.chats.find((chat) => chat.id === "chat-2");
              if (!remoteConversation) {
                throw new Error("Missing chat-2 fixture.");
              }
              state = applyWorkspaceMutationsToState(state, [{ type: "updateConversation", conversation: { ...remoteConversation, title: "Remote title" } }]);
              serverRevision = 4;
              resolve(
                Response.json(
                  {
                    error: "Workspace revision conflict: expected 3, current 4.",
                    code: "workspace_revision_conflict",
                    expectedRevision: 3,
                    revision: serverRevision,
                    workspace: state,
                  },
                  { status: 409 },
                ),
              );
            };
          });
        }
        state = applyWorkspaceMutationRequest(state, init);
        serverRevision += 1;
        return Response.json({ ok: true, revision: serverRevision });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        runRequests.push(JSON.parse(String(init?.body ?? "{}")) as RunRequestRecord);
        activeRunSignal = init?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "start" })}\n`));
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "reasoning", text: "live reasoning" })}\n`));
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "send" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runRequests).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
      await Promise.resolve();
    });
    expect(screen.getByTestId("agent-blocks")).toHaveTextContent("live reasoning");

    await act(async () => {
      resolveFirstSave?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveAttempts).toBe(1);
    expect(screen.getByTestId("agent-blocks")).toHaveTextContent("live reasoning");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    expect(saveAttempts).toBe(2);
    expect(mutationPayloads[1]?.baseRevision).toBe(4);
    expect(
      mutationPayloads[1]?.mutations?.some(
        (mutation) => mutation.type === "upsertMessage" && mutation.message.role === "agent" && (mutation.message.blocks ?? []).length === 0,
      ),
    ).toBe(false);
    expect(screen.getByTestId("agent-blocks")).toHaveTextContent("live reasoning");
  });

  it("persists application settings to the server instead of localStorage", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("locale")).toHaveTextContent("ru");

    screen.getByRole("button", { name: "update-settings" }).click();

    await waitFor(() => {
      expect(state.settings.appearance.theme).toBe("light");
      expect(state.settings.appearance.density).toBe("compact");
      expect(state.settings.appearance.reduceMotion).toBe(true);
      expect(state.settings.appearance.sidebarWidth).toBe(360);
      expect(state.settings.general.locale).toBe("en");
    });
    expect(localStorageSetItem).not.toHaveBeenCalledWith(expect.stringContaining("rlab-settings"), expect.any(String));
  });

  it("cancels the active run without letting the run overwrite the canceled status", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    screen.getByRole("button", { name: "stop" }).click();

    await waitFor(() => {
      expect(activeRunSignal?.aborted).toBe(true);
      expect(runCancelRequests).toEqual([{ runId: runRequests[0]?.runId }]);
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
      expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("ok");
    });
    expect(JSON.stringify(state.threads["chat-2"])).not.toContain("Aborted");
    activeRunController = undefined;
  });

  it("persists usage cost and tokens from a completed run", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "done", costUsd: 0.0173, usage: { totalTokens: 9653 } })}\n`));
    activeRunController?.close();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("done");
      expect(screen.getByTestId("cost")).toHaveTextContent("0.0173");
      expect(screen.getByTestId("usage")).toHaveTextContent("9653");
    });
    expect(state.chats.find((chat) => chat.id === "chat-2")?.costUsd).toBe(0.0173);
    expect(state.chats.find((chat) => chat.id === "chat-2")?.usage).toEqual({ totalTokens: 9653 });
    const agentMessage = [...state.threads["chat-2"]].reverse().find((message) => message.role === "agent");
    expect(agentMessage?.costUsd).toBe(0.0173);
    expect(agentMessage?.usage).toEqual({ totalTokens: 9653 });
  });

  it("clears stale context usage immediately when manual compaction starts", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? {
              ...chat,
              agent: "codex",
              profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
              sessionAgent: "codex",
              sessionId: "codex-session-1",
              usage: { contextTokens: 300000 },
            }
          : chat,
      ),
    };

    render(<Probe />);

    await screen.findByText("chat-2");
    expect(screen.getByTestId("context-usage")).toHaveTextContent("300000");

    await act(async () => {
      screen.getByRole("button", { name: "compact" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("context-usage")).toHaveTextContent("0");
      expect(runRequests).toHaveLength(1);
    });
    expect(runRequests[0]).toMatchObject({ agent: "codex", prompt: "/compact", resume: "codex-session-1" });
    expect(state.chats.find((chat) => chat.id === "chat-2")?.usage?.contextTokens).toBe(0);
  });

  it("keeps a bound background run running after the client stream disconnects and settles from workspace sync", async () => {
    vi.useFakeTimers();
    let activeRunReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        activeRunReads += 1;
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        runRequests.push(JSON.parse(String(init?.body ?? "{}")) as {
          accessMode?: string;
          agent?: string;
          agentMessageId?: string;
          conversationId?: string;
          prompt?: string;
          model?: string;
          reasoning?: string;
          runId?: string;
          userMessageId?: string;
          mode?: string;
        });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "start" })}\n`));
            controller.error(new Error("client stream disconnected"));
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      if (url === "/api/run-cancel") {
        runCancelRequests.push(JSON.parse(String(init?.body ?? "{}")) as { runId?: string });
        return Response.json({ canceled: true });
      }
      return new Response("not found", { status: 404 });
    });
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: "send" }).click();
    });

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      }
    });
    expect(screen.getByTestId("status")).toHaveTextContent("running");
    expect(state.chats.find((chat) => chat.id === "chat-2")?.activeRunId).toBe(runRequests[0]?.runId);
    expect(JSON.stringify(state.threads["chat-2"])).not.toContain("client stream disconnected");
    expect(JSON.stringify(state.threads["chat-2"])).toContain("Запуск продолжается в фоне");

    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: undefined, status: "done", snippet: "finished" } : chat)),
      threads: {
        ...state.threads,
        "chat-2": [...state.threads["chat-2"], { id: "a-bg-done", role: "agent", blocks: [{ kind: "text", text: "finished" }] }],
      },
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("done");
    expect(activeRunReads).toBeGreaterThan(0);
  });

  it("marks a conversation waiting while a streamed approval is pending", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    activeRunController?.enqueue(
      new TextEncoder().encode(`${JSON.stringify({ type: "approval", id: "approval-1", title: "Approve Bash command?", detail: "npm test" })}\n`),
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("waiting");
      expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("ok");
    });

    screen.getByRole("button", { name: "approve" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("running");
      expect(JSON.stringify(state.threads["chat-2"])).toContain("\"decision\":\"approved\"");
    });

    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`));
    activeRunController?.close();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("done");
      expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("ok");
      expect(JSON.stringify(state.threads["chat-2"])).toContain("\"decision\":\"approved\"");
    });
  });

  it("sends the selected conversation profile to the run API", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2" ? { ...chat, agent: "codex", profile: { agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" } } : chat,
      ),
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests[0]).toMatchObject({
        agent: "codex",
        agentMessageId: expect.stringMatching(/^a-/),
        conversationId: "chat-2",
        prompt: expect.stringContaining("Persist this message"),
        runId: expect.stringMatching(/^run-/),
        userMessageId: expect.stringMatching(/^u-/),
        model: "gpt-5.5",
        reasoning: "high",
        mode: "default",
      });
    });
  });

  it("keeps native session forks per runnable agent and resumes the selected agent's branch", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? { ...chat, activeRunId: undefined, status: "idle", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" } }
          : chat,
      ),
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        const request = JSON.parse(String(init?.body ?? "{}")) as RunRequestRecord;
        runRequests.push(request);
        const sessionId = `${request.agent ?? "agent"}-session-${runRequests.length}`;
        activeRunSignal = init?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "session", id: sessionId })}\n`));
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "text", text: "ok" })}\n`));
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      if (url === "/api/run-cancel") {
        runCancelRequests.push(JSON.parse(String(init?.body ?? "{}")) as { runId?: string });
        return Response.json({ canceled: true });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(runRequests[0]).toMatchObject({ agent: "codex", prompt: expect.stringContaining("Persist this message") });
    expect(runRequests[0]?.resume).toBeUndefined();
    expect(state.chats.find((chat) => chat.id === "chat-2")?.agentSessions).toEqual({ codex: "codex-session-1" });

    screen.getByRole("button", { name: "agent-claude" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(runRequests[1]).toMatchObject({ agent: "claude-code", prompt: expect.stringContaining("This is a continuing conversation") });
    expect(runRequests[1]?.resume).toBeUndefined();
    expect(state.chats.find((chat) => chat.id === "chat-2")?.agentSessions).toEqual({
      "claude-code": "claude-code-session-2",
      codex: "codex-session-1",
    });

    screen.getByRole("button", { name: "agent-gemini" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(3));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(runRequests[2]).toMatchObject({ agent: "gemini", prompt: expect.stringContaining("This is a continuing conversation") });
    expect(runRequests[2]?.resume).toBeUndefined();
    expect(state.chats.find((chat) => chat.id === "chat-2")?.agentSessions).toEqual({
      "claude-code": "claude-code-session-2",
      codex: "codex-session-1",
      gemini: "gemini-session-3",
    });

    screen.getByRole("button", { name: "agent-opencode" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(4));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(runRequests[3]).toMatchObject({ agent: "opencode", prompt: expect.stringContaining("This is a continuing conversation") });
    expect(runRequests[3]?.resume).toBeUndefined();
    expect(state.chats.find((chat) => chat.id === "chat-2")?.agentSessions).toEqual({
      "claude-code": "claude-code-session-2",
      codex: "codex-session-1",
      gemini: "gemini-session-3",
      opencode: "opencode-session-4",
    });

    screen.getByRole("button", { name: "agent-codex" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(5));
    expect(runRequests[4]).toMatchObject({
      agent: "codex",
      prompt: "Persist this message",
      resume: "codex-session-1",
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    screen.getByRole("button", { name: "agent-gemini" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(6));
    expect(runRequests[5]).toMatchObject({
      agent: "gemini",
      prompt: "Persist this message",
      resume: "gemini-session-3",
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    screen.getByRole("button", { name: "agent-opencode" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(7));
    expect(runRequests[6]).toMatchObject({
      agent: "opencode",
      prompt: "Persist this message",
      resume: "opencode-session-4",
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    screen.getByRole("button", { name: "agent-claude" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(8));
    expect(runRequests[7]).toMatchObject({
      agent: "claude-code",
      prompt: "Persist this message",
      resume: "claude-code-session-2",
    });
  });

  it("uses the latest selected agent for queued messages after switching during a run", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? { ...chat, activeRunId: undefined, status: "idle", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" } }
          : chat,
      ),
    };
    const encoder = new TextEncoder();
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const encodeEvent = (event: unknown) => encoder.encode(`${JSON.stringify(event)}\n`);
    const finishRun = (index: number) => {
      controllers[index]?.enqueue(encodeEvent({ type: "done" }));
      controllers[index]?.close();
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        const request = JSON.parse(String(init?.body ?? "{}")) as RunRequestRecord;
        runRequests.push(request);
        const sessionId = `${request.agent ?? "agent"}-session-${runRequests.length}`;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
            controller.enqueue(encodeEvent({ type: "session", id: sessionId }));
            controller.enqueue(encodeEvent({ type: "text", text: "ok" }));
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      if (url === "/api/run-cancel") {
        runCancelRequests.push(JSON.parse(String(init?.body ?? "{}")) as { runId?: string });
        return Response.json({ canceled: true });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(1));
    expect(runRequests[0]).toMatchObject({
      agent: "codex",
      prompt: expect.stringContaining("Persist this message"),
    });
    expect(runRequests[0]?.resume).toBeUndefined();

    screen.getByRole("button", { name: "agent-claude" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));
    expect(runRequests).toHaveLength(1);

    await act(async () => {
      finishRun(0);
    });

    await waitFor(() => expect(runRequests).toHaveLength(2));
    expect(runRequests[1]).toMatchObject({
      agent: "claude-code",
      prompt: expect.stringContaining("This is a continuing conversation"),
    });
    expect(runRequests[1]?.resume).toBeUndefined();
    expect(state.chats.find((chat) => chat.id === "chat-2")?.agentSessions).toEqual({
      "claude-code": "claude-code-session-2",
      codex: "codex-session-1",
    });

    await act(async () => {
      finishRun(1);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));

    screen.getByRole("button", { name: "agent-codex" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(3));
    expect(runRequests[2]).toMatchObject({
      agent: "codex",
      prompt: "Persist this message",
      resume: "codex-session-1",
    });

    await act(async () => {
      finishRun(2);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));

    screen.getByRole("button", { name: "agent-claude" }).click();
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(4));
    expect(runRequests[3]).toMatchObject({
      agent: "claude-code",
      prompt: "Persist this message",
      resume: "claude-code-session-2",
    });

    await act(async () => {
      finishRun(3);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
  });

  it("keeps queued messages paused after stop until the user sends one now", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? { ...chat, activeRunId: undefined, status: "idle", agent: "codex", profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" } }
          : chat,
      ),
    };
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        const request = JSON.parse(String(init?.body ?? "{}")) as RunRequestRecord;
        runRequests.push(request);
        const sessionId = `${request.agent ?? "agent"}-session-${runRequests.length}`;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "session", id: sessionId })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "text", text: "ok" })}\n`));
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      if (url === "/api/run-cancel") {
        runCancelRequests.push(JSON.parse(String(init?.body ?? "{}")) as { runId?: string });
        return Response.json({ canceled: true });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(1));

    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => expect(screen.getByTestId("queued")).toHaveTextContent("1"));
    expect(runRequests).toHaveLength(1);

    screen.getByRole("button", { name: "stop" }).click();
    await waitFor(() => expect(runCancelRequests).toHaveLength(1));
    expect(screen.getByTestId("queued")).toHaveTextContent("1");
    expect(runRequests).toHaveLength(1);

    screen.getByRole("button", { name: "send-queued-now" }).click();
    await waitFor(() => expect(runRequests).toHaveLength(2));
    expect(screen.getByTestId("queued")).toHaveTextContent("0");
    expect(runRequests[1]).toMatchObject({
      agent: "codex",
      prompt: "Persist this message",
      resume: "codex-session-1",
    });
    expect((state.threads["chat-2"] ?? []).filter((message) => message.role === "user" && message.text === "Persist this message")).toHaveLength(2);
  });

  it("derives unrestricted run access from the default chat agent mode", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests[0]).toMatchObject({ accessMode: "unrestricted" });
    });
  });

  it("derives read-only run access from plan mode", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, profile: { agent: "codex", model: "default", reasoning: "default", mode: "plan" } } : chat)),
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests[0]).toMatchObject({ accessMode: "read-only" });
    });
  });

  it("does not poll seeded running conversations that are not real background runs", async () => {
    vi.useFakeTimers();
    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();

    const initialWorkspaceReads = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && (!init || init.method === "GET")).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });

    const workspaceReads = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && (!init || init.method === "GET")).length;
    expect(workspaceReads).toBe(initialWorkspaceReads);
  });

  it("applies persisted background run attach updates without marking the workspace as loading", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");

    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-existing",
            conversationId: "chat-2",
            userMessageId: "test-user-message",
            agentMessageId: "test-agent-message",
            status: "done",
            snippet: "finished",
            time: "14:01",
            done: true,
            blocks: [{ kind: "text", text: "finished" }],
          },
        })}\n`,
      ),
    );
    attachRunController?.close();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("done");
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("reattaches when a background run attach stream closes before a terminal update", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });

    attachRunController?.close();

    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing", "/api/run-attach?runId=run-existing"]);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("running");
  });

  it("reattaches to a server-active run the persisted status missed (e.g. after a reload)", async () => {
    // The conversation looks finished/broken in saved state (no activeRunId,
    // "error"), but the server still owns a live run for it — one left mid-stream,
    // alive and waiting for tool approval. A reload must reattach, not abandon it.
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, status: "error", activeRunId: undefined } : chat)),
    };
    const liveRun = {
      runId: "run-live",
      conversationId: "chat-2",
      userMessageId: "test-user-message",
      agentMessageId: "test-agent-message",
      startedAt: "2026-06-06T14:00:00.000Z",
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json({ runs: [liveRun] });
      }
      if (url.startsWith("/api/run-attach")) {
        attachRunRequests.push(url);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            attachRunController = controller;
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-live"]);
    });

    // The attach stream heals the conversation back to its real (waiting) status.
    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-live",
            conversationId: "chat-2",
            userMessageId: "test-user-message",
            agentMessageId: "test-agent-message",
            status: "waiting",
            snippet: "Waiting for input",
            time: "14:01",
            done: false,
            blocks: [{ kind: "tool", name: "Bash", summary: "systemctl is-active rlab", state: "pending" }],
          },
        })}\n`,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("waiting");
    });
  });

  it("does not save server-owned attach stream updates back through the workspace API", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "test-agent-message", role: "agent", time: "14:00", blocks: [{ kind: "reasoning", text: "", active: true }] },
        ],
      },
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });
    const workspaceSavesBeforeAttachUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;

    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-existing",
            conversationId: "chat-2",
            userMessageId: "test-user-message",
            agentMessageId: "test-agent-message",
            status: "running",
            snippet: "streamed token",
            time: "14:01",
            done: false,
            blocks: [{ kind: "text", text: "streamed token", streaming: true }],
          },
        })}\n`,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("running");
    });
    const workspaceSavesAfterAttachUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;
    expect(workspaceSavesAfterAttachUpdate).toBe(workspaceSavesBeforeAttachUpdate);
  });

  it("places attached run updates next to their bound user message", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "u-repeat", role: "user", text: "First queued turn", time: "14:00" },
          { id: "u-later", role: "user", text: "Later queued turn", time: "14:01" },
        ],
      },
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });

    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-existing",
            conversationId: "chat-2",
            userMessageId: "u-repeat",
            agentMessageId: "a-repeat",
            status: "running",
            snippet: "streamed token",
            time: "14:02",
            done: false,
            blocks: [{ kind: "text", text: "streamed token", streaming: true }],
          },
        })}\n`,
      ),
    );

    await waitFor(() => {
      const ids = screen.getByTestId("thread-ids").textContent?.split(",") ?? [];
      expect(ids.slice(ids.indexOf("u-repeat"), ids.indexOf("u-later") + 1)).toEqual(["u-repeat", "a-repeat", "u-later"]);
    });
  });

  it("does not save accepted local background run stream updates back through the workspace API", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        return Response.json(activeRunsPayloadFromState(state));
      }
      if (url === "/api/run") {
        runRequests.push(JSON.parse(String(init?.body ?? "{}")) as {
          accessMode?: string;
          agent?: string;
          agentMessageId?: string;
          conversationId?: string;
          prompt?: string;
          model?: string;
          reasoning?: string;
          runId?: string;
          userMessageId?: string;
          mode?: string;
        });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();
    await waitFor(() => {
      expect(runRequests).toHaveLength(1);
    });
    const workspaceSavesBeforeStreamUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;

    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "text", text: "server token" })}\n`));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("running");
    });
    const workspaceSavesAfterStreamUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;
    expect(workspaceSavesAfterStreamUpdate).toBe(workspaceSavesBeforeStreamUpdate);
  });

  it("immediately syncs a persisted background run after loading workspace state", async () => {
    vi.useFakeTimers();
    const runningState: WorkspaceState = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
    };
    const doneState: WorkspaceState = {
      ...runningState,
      chats: runningState.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: undefined, status: "done", snippet: "finished" } : chat)),
      threads: {
        ...runningState.threads,
        "chat-2": [...runningState.threads["chat-2"], { id: "a-bg", role: "agent", blocks: [{ kind: "text", text: "finished" }] }],
      },
    };
    let workspaceReads = 0;
    let activeRunReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        workspaceReads += 1;
        return Response.json(workspaceReads === 1 ? runningState : doneState);
      }
      if (url === "/api/workspace/mutations" && init?.method === "POST") {
        state = applyWorkspaceMutationRequest(state, init);
        return Response.json({ ok: true });
      }
      if (url === "/api/runs") {
        activeRunReads += 1;
        return Response.json({ runs: [] });
      }
      return new Response("not found", { status: 404 });
    });

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("chat-2")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("done");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(workspaceReads).toBe(2);
    expect(activeRunReads).toBe(1);
  });

  it("attaches to an already active background run instead of starting the agent again", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "test-agent-message", role: "agent", time: "14:00", blocks: [{ kind: "reasoning", text: "", active: true }] },
        ],
      },
    };

    render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });
    expect(runRequests).toEqual([]);

    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-existing",
            conversationId: "chat-2",
            userMessageId: "test-user-message",
            agentMessageId: "test-agent-message",
            status: "done",
            snippet: "attached finished",
            time: "14:01",
            done: true,
            blocks: [{ kind: "text", text: "attached finished" }],
          },
        })}\n`,
      ),
    );
    attachRunController?.close();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("done");
    });
    expect(runRequests).toEqual([]);
  });

  it("reconciles an attached background run when the attach stream goes silent after the server run disappears", async () => {
    vi.useFakeTimers();
    const runningState: WorkspaceState = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "test-agent-message", role: "agent", time: "14:00", blocks: [{ kind: "reasoning", text: "", active: true }] },
        ],
      },
    };
    const doneState: WorkspaceState = {
      ...runningState,
      chats: runningState.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: undefined, status: "done", snippet: "finished" } : chat)),
      threads: {
        ...runningState.threads,
        "chat-2": [...runningState.threads["chat-2"].slice(0, -1), { id: "test-agent-message", role: "agent", time: "14:01", blocks: [{ kind: "text", text: "finished" }] }],
      },
    };
    state = runningState;

    render(<Probe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();
    expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);

    state = doneState;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("done");
    expect(attachRunSignal?.aborted).toBe(true);
    expect(runRequests).toEqual([]);
  });

  it("closes background run attach streams on unmount without canceling the server run", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
    };

    const view = render(<Probe />);

    await screen.findByText("chat-2");
    await waitFor(() => {
      expect(attachRunRequests).toEqual(["/api/run-attach?runId=run-existing"]);
    });

    view.unmount();

    expect(attachRunSignal?.aborted).toBe(true);
    expect(runCancelRequests).toEqual([]);
    expect(runRequests).toEqual([]);
  });

  it("does not save or rerender when a persisted background run snapshot is unchanged", async () => {
    vi.useFakeTimers();
    let renders = 0;
    state = {
      ...state,
      chats: state.chats.map((chat) => (chat.id === "chat-2" ? { ...chat, activeRunId: "run-existing", status: "running" } : chat)),
    };
    const CountingProbe = () => {
      renders += 1;
      return <Probe />;
    };
    render(<CountingProbe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("chat-2")).toBeInTheDocument();
    const rendersAfterLoad = renders;
    const workspaceSavesAfterLoad = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    const workspaceSavesAfterPoll = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace/mutations" && init?.method === "POST").length;
    expect(renders).toBe(rendersAfterLoad);
    expect(workspaceSavesAfterPoll).toBe(workspaceSavesAfterLoad);
  });

  it("retries a user message in place without duplicating it", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "retry" }).click();

    await waitFor(() => {
      // Re-run keeps a single copy of the user turn (the stale reply is dropped
      // and regenerated), not a duplicate.
      const repeated = state.threads["chat-2"].filter((message) => message.text === "Собери черновик release notes для 0.1.69 по merged PR.");
      expect(repeated).toHaveLength(1);
    });
  });

  it("forks a conversation from an agent message without reusing the parent native session", async () => {
    state = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? {
              ...chat,
              agentSessions: { codex: "source-session" },
              sessionAgent: "codex",
              sessionId: "source-session",
            }
          : chat,
      ),
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    const sourceMessageIds = new Set(state.threads["chat-2"].map((message) => message.id));
    await act(async () => {
      screen.getByRole("button", { name: "fork-a1" }).click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected").textContent).not.toBe("chat-2");
      expect(state.selectedId).not.toBe("chat-2");
    });

    const fork = state.chats.find((chat) => chat.id === state.selectedId);
    expect(fork).toMatchObject({
      title: "Форк: Release notes для 0.1.69",
      status: "idle",
      agent: "codex",
      profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
    });
    expect(fork?.agentSessions).toBeUndefined();
    expect(fork?.sessionId).toBeUndefined();
    expect(fork?.sessionAgent).toBeUndefined();
    expect(state.threads[state.selectedId]).toHaveLength(2);
    const forkedMessageIds = state.threads[state.selectedId].map((message) => message.id);
    expect(forkedMessageIds.some((messageId) => sourceMessageIds.has(messageId))).toBe(false);
    const forkedAgentMessage = state.threads[state.selectedId][1];
    expect(forkedAgentMessage?.role).toBe("agent");
    const streamingText = forkedAgentMessage?.blocks?.find((block) => block.kind === "text" && block.text.includes("Открыть PR"));
    expect(streamingText).toMatchObject({ kind: "text", streaming: false });
  });

  it("resends a user message with edited text", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "edit-resend" }).click();

    await waitFor(() => {
      expect(state.threads["chat-2"].some((message) => message.text === "Edited resend text")).toBe(true);
    });
  });

  it("creates a new conversation inside a project", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    const initialChatCount = state.chats.length;
    const initialProjectCount = state.projects.find((project) => project.id === "auth-service")?.conversations.length ?? 0;
    screen.getByRole("button", { name: "new-project-chat" }).click();

    await waitFor(() => {
      const project = state.projects.find((item) => item.id === "auth-service");
      expect(project?.conversations).toHaveLength(initialProjectCount + 1);
      expect(project?.conversations[0]?.title).toBe("Новый чат");
      expect(project?.conversations[0]?.agent).toBe("claude-code");
      expect(state.selectedId).toBe(project?.conversations[0]?.id);
      expect(state.chats).toHaveLength(initialChatCount);
    });
  });

  it("creates a project bound to a real path with a starter conversation", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "create-project" }).click();

    await waitFor(() => {
      const project = state.projects.find((item) => item.id === "billing");
      expect(project?.name).toBe("billing");
      expect(project?.path).toBe("C:\\work\\billing");
      expect(project?.conversations).toHaveLength(1);
      expect(project?.conversations[0]?.profile).toEqual({ agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" });
      expect(state.selectedId).toBe(project?.conversations[0]?.id);
    });
  });
});

