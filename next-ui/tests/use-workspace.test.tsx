import { render, screen, waitFor } from "@testing-library/react";
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
      <button type="button" onClick={() => workspace.newProjectChat("auth-service", { agent: "claude-code", variant: "DEFAULT" })}>
        new-project-chat
      </button>
      <button type="button" onClick={() => workspace.createProject({ name: "billing", path: "C:\\work\\billing", profile: { agent: "codex", variant: "GPT-5.5" } })}>
        create-project
      </button>
      <button
        type="button"
        onClick={() =>
          workspace.updateSettings({
            appearance: { density: "compact", reduceMotion: true, theme: "light" },
            general: { locale: "en" },
          })
        }
      >
        update-settings
      </button>
    </div>
  );
}

describe("useWorkspace", () => {
  let state: WorkspaceState;
  let localStorageSetItem: ReturnType<typeof vi.fn>;
  let originalLocalStorage: PropertyDescriptor | undefined;
  let activeRunSignal: AbortSignal | undefined;
  let activeRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let runRequests: Array<{
    readonly accessMode?: string;
    readonly agent?: string;
    readonly agentMessageId?: string;
    readonly conversationId?: string;
    readonly prompt?: string;
    readonly runId?: string;
    readonly userMessageId?: string;
    readonly variant?: string;
  }> = [];
  let runCancelRequests: Array<{ readonly runId?: string }> = [];

  beforeEach(() => {
    state = buildInitialWorkspaceState();
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
        if (url === "/api/run") {
          runRequests.push(JSON.parse(String(init?.body ?? "{}")) as {
            accessMode?: string;
            agent?: string;
            agentMessageId?: string;
            conversationId?: string;
            prompt?: string;
            runId?: string;
            userMessageId?: string;
            variant?: string;
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
    expect(state.chats.find((chat) => chat.id === "chat-2")?.snippet).toBe("Прогон остановлен");
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
        chat.id === "chat-2" ? { ...chat, agent: "codex", profile: { agent: "codex", variant: "GPT-5.5" } } : chat,
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
        variant: "GPT-5.5",
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
          accessMode: "read-write",
        },
      },
    };
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "send" }).click();

    await waitFor(() => {
      expect(runRequests[0]).toMatchObject({ accessMode: "read-write" });
    });
  });

  it("retries a user message by resending its original text", async () => {
    render(<Probe />);

    await screen.findByText("chat-2");
    screen.getByRole("button", { name: "retry" }).click();

    await waitFor(() => {
      const repeated = state.threads["chat-2"].filter((message) => message.text === "Собери черновик release notes для 0.1.69 по merged PR.");
      expect(repeated).toHaveLength(2);
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
      expect(project?.conversations[0]?.profile).toEqual({ agent: "codex", variant: "GPT-5.5" });
      expect(state.selectedId).toBe(project?.conversations[0]?.id);
    });
  });
});
