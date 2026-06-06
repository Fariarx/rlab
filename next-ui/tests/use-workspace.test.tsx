import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../src/components/workspace/use-workspace";
import { buildInitialWorkspaceState, type WorkspaceState } from "../src/components/workspace/workspace-state";

function Probe() {
  const workspace = useWorkspace();
  const selected = workspace.find(workspace.selectedId);
  return (
    <div>
      <div data-testid="selected">{workspace.selectedId}</div>
      <div data-testid="status">{selected?.status}</div>
      <div data-testid="theme">{workspace.settings.appearance.theme}</div>
      <div data-testid="locale">{workspace.settings.general.locale}</div>
      <div data-testid="density">{workspace.settings.appearance.density}</div>
      <div data-testid="loading">{String(workspace.loading)}</div>
      <div data-testid="error">{workspace.loadError ?? "none"}</div>
      <div data-testid="cost">{selected?.costUsd ?? "none"}</div>
      <div data-testid="usage">{selected?.usage?.totalTokens ?? "none"}</div>
      <button type="button" onClick={() => workspace.sendMessage(workspace.selectedId, "Persist this message")}>
        send
      </button>
      <button type="button" onClick={() => workspace.stopRun(workspace.selectedId)}>
        stop
      </button>
      <button type="button" onClick={() => workspace.retryMessage(workspace.selectedId, "u1")}>
        retry
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
}

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

describe("useWorkspace", () => {
  let state: WorkspaceState;
  let localStorageSetItem: ReturnType<typeof vi.fn>;
  let originalLocalStorage: PropertyDescriptor | undefined;
  let activeRunSignal: AbortSignal | undefined;
  let activeRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let attachRunSignal: AbortSignal | undefined;
  let attachRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let attachRunRequests: string[] = [];
  let runRequests: Array<{
    readonly accessMode?: string;
    readonly agent?: string;
    readonly agentMessageId?: string;
    readonly conversationId?: string;
    readonly prompt?: string;
    readonly model?: string;
    readonly reasoning?: string;
    readonly runId?: string;
    readonly userMessageId?: string;
    readonly mode?: string;
  }> = [];
  let runCancelRequests: Array<{ readonly runId?: string }> = [];

  beforeEach(() => {
    state = buildInitialWorkspaceState();
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
          return Response.json(state);
        }
        if (url === "/api/workspace" && init?.method === "PUT") {
          state = JSON.parse(String(init.body)) as WorkspaceState;
          return Response.json(state);
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

    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && init?.method === "PUT")).toHaveLength(0);
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
      if (url === "/api/workspace" && init?.method === "PUT") {
        state = JSON.parse(String(init.body)) as WorkspaceState;
        return Response.json(state);
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
      expect(fetch).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "PUT" }));
    });
    expect(state.threads["chat-2"].some((message) => message.text === "Persist this message")).toBe(true);
    expect(localStorageSetItem).not.toHaveBeenCalledWith(expect.stringContaining("rlab-workspace"), expect.any(String));
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
    });
    expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("Запуск остановлен");
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
  });

  it("keeps a bound background run running after the client stream disconnects and settles from workspace sync", async () => {
    vi.useFakeTimers();
    let activeRunReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(state);
      }
      if (url === "/api/workspace" && init?.method === "PUT") {
        state = JSON.parse(String(init.body)) as WorkspaceState;
        return Response.json(state);
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
    screen.getByRole("button", { name: "send" }).click();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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
      expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("Ждёт ввод");
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
        prompt: "Persist this message",
        runId: expect.stringMatching(/^run-/),
        userMessageId: expect.stringMatching(/^u-/),
        model: "gpt-5.5",
        reasoning: "high",
        mode: "default",
      });
    });
  });

  it("sends the configured filesystem access mode to the run API", async () => {
    state = {
      ...state,
      settings: {
        ...state.settings,
        agents: {
          ...state.settings.agents,
          accessMode: "unrestricted",
        },
      },
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests[0]).toMatchObject({ accessMode: "unrestricted" });
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
    const workspaceSavesBeforeAttachUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && init?.method === "PUT").length;

    attachRunController?.enqueue(
      new TextEncoder().encode(
        `${JSON.stringify({
          type: "update",
          update: {
            runId: "run-existing",
            conversationId: "chat-2",
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
    const workspaceSavesAfterAttachUpdate = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && init?.method === "PUT").length;
    expect(workspaceSavesAfterAttachUpdate).toBe(workspaceSavesBeforeAttachUpdate);
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
      if (url === "/api/workspace" && init?.method === "PUT") {
        state = JSON.parse(String(init.body)) as WorkspaceState;
        return Response.json(state);
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
    const workspaceSavesAfterLoad = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && init?.method === "PUT").length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    const workspaceSavesAfterPoll = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/workspace" && init?.method === "PUT").length;
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
      expect(state.threads[state.selectedId]).toBeDefined();
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
