import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "../src/components/workspace/WorkspacePage";
import { buildInitialWorkspaceState } from "../src/components/workspace/workspace-state";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";

type PersistedComposerAttachmentDraft = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly size: number;
  readonly lastModified: number;
};

type WorkspaceStateWithComposerDrafts = ReturnType<typeof buildInitialWorkspaceState> & {
  readonly composerDrafts?: Record<string, { readonly text: string; readonly attachments: readonly PersistedComposerAttachmentDraft[] }>;
};

function activeRunsResponse(path: string): Response | null {
  return path === "/api/runs" ? Response.json({ runs: [] }) : null;
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    let workspace = buildInitialWorkspaceState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
        if (path === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json(workspace);
        }
        if (path === "/api/workspace" && init?.method === "PUT") {
          workspace = JSON.parse(String(init.body)) as typeof workspace;
          return Response.json(workspace);
        }
        if (path === "/api/project-files") {
          return Response.json({ files: [] });
        }
        if (path === "/api/run") {
          return new Response(`${JSON.stringify({ type: "done" })}\n`, {
            headers: { "Content-Type": "application/x-ndjson" },
          });
        }
        if (path === "/api/agent-config") {
          return Response.json({ agents: {} });
        }
        return Response.json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the sidebar, chats list, and conversation thread", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(screen.getByText("rlab / агенты")).toBeInTheDocument();
    // Appears in both the sidebar row and the pane header.
    expect(screen.getAllByText(/Release notes для 0\.1\.69/i).length).toBeGreaterThan(0);
    // Default conversation thread (release notes) is rendered in the pane.
    expect(screen.getByText(/по merged PR/i)).toBeInTheDocument();
  });

  it("shows projects in the unified sidebar list", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("opens the agent picker from the agent badge", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    const agentBadge = screen.getByRole("button", { name: /Изменить агента/i });
    expect(agentBadge.textContent).not.toContain(" · ");
    expect(agentBadge.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(agentBadge);
    expect(screen.getByText("Выбор агента")).toBeInTheDocument();
  });

  it("opens the command palette from the keyboard", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Палитра команд" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Найти команду...")).toBeInTheDocument();
  });

  it("opens conversation search from the command palette", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const palette = screen.getByRole("dialog", { name: "Палитра команд" });
    fireEvent.click(within(palette).getByRole("option", { name: "Поиск диалогов..." }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Поиск по названию или сообщению...")).toBeInTheDocument();
    });
  });

  it("runs the active command palette item selected with arrow keys", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText("Найти команду...");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const palette = screen.getByRole("dialog", { name: "Палитра команд" });
    expect(within(palette).getByRole("option", { name: "Поиск диалогов..." })).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Поиск по названию или сообщению...")).toBeInTheDocument();
    });
  });

  it("exposes the active command palette option to assistive technology", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = screen.getByRole("combobox", { name: "Палитра команд" });
    const listbox = screen.getByRole("listbox", { name: "Палитра команд" });
    const initialOptions = within(listbox).getAllByRole("option");

    expect(input).toHaveAttribute("aria-controls", "command-palette-list");
    expect(input).toHaveAttribute("aria-activedescendant", initialOptions[0].id);
    expect(initialOptions[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const movedOptions = within(listbox).getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", movedOptions[1].id);
    expect(movedOptions[1]).toHaveAttribute("aria-selected", "true");
  });

  it("filters command palette items and opens settings", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText("Найти команду..."), { target: { value: "настрой" } });

    const palette = screen.getByRole("dialog", { name: "Палитра команд" });
    expect(within(palette).getByRole("option", { name: "Открыть настройки" })).toBeInTheDocument();
    expect(within(palette).queryByRole("option", { name: "Поиск диалогов..." })).not.toBeInTheDocument();

    fireEvent.click(within(palette).getByRole("option", { name: "Открыть настройки" }));

    expect(screen.getByRole("tab", { name: "Внешний вид" })).toBeInTheDocument();
  });

  it("creates a new chat immediately from the new-conversation menu", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Новый диалог" }));

    // The "+" opens a menu to pick where the chat lives; "Простой чат" creates a
    // standalone conversation right away (no draft/prelude), with the default agent.
    fireEvent.click(await screen.findByRole("menuitem", { name: "Простой чат" }));

    const input = await screen.findByPlaceholderText("Написать: CC");
    fireEvent.change(input, { target: { value: "Set up CI" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getAllByText("Set up CI").length).toBeGreaterThan(0);
    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("opens the create project dialog", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));

    expect(screen.getByRole("dialog", { name: "Создать проект" })).toBeInTheDocument();
    expect(screen.getByLabelText("Название проекта")).toBeInTheDocument();
    expect(screen.getByLabelText("Папка проекта")).toBeInTheDocument();
  });

  it("deletes a conversation immediately when destructive confirmations are disabled", async () => {
    let workspace = {
      ...buildInitialWorkspaceState(),
      settings: {
        ...buildInitialWorkspaceState().settings,
        general: {
          ...buildInitialWorkspaceState().settings.general,
          confirmDestructiveActions: false,
        },
      },
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        workspace = JSON.parse(String(init.body)) as typeof workspace;
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    // Projects and chats share one list, so target chat-2's row explicitly
    // rather than relying on which conversation happens to be first.
    const chatRow = await screen.findByRole("option", { name: "Release notes для 0.1.69" });
    fireEvent.click(within(chatRow).getByRole("button", { name: "Действия с диалогом" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить" }));

    await waitFor(() => {
      expect(workspace.chats.some((chat) => chat.id === "chat-2")).toBe(false);
    });
    expect(screen.queryByRole("dialog", { name: "Удалить диалог?" })).not.toBeInTheDocument();
  });

  it("sends a message into the active conversation", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    const input = await screen.findByPlaceholderText(/^Написать:/);
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Appears as the new user message in the thread (and as the sidebar snippet).
    expect(screen.getAllByText("Ship it").length).toBeGreaterThan(0);
  });

  it("persists composer text drafts through the workspace API and restores them after remount", async () => {
    let workspace: WorkspaceStateWithComposerDrafts = buildInitialWorkspaceState();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        workspace = JSON.parse(String(init.body)) as WorkspaceStateWithComposerDrafts;
        return Response.json(workspace);
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    const firstRender = renderWithThemeAndVirtuoso(<WorkspacePage />);
    const input = await screen.findByPlaceholderText(/^Написать:/);

    fireEvent.change(input, { target: { value: "Черновик не из браузера" } });

    await waitFor(() => {
      expect(workspace.composerDrafts?.["chat-2"]?.text).toBe("Черновик не из браузера");
    });

    firstRender.unmount();
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/^Написать:/)).toHaveValue("Черновик не из браузера");
    });
  });

  it("persists composer attachment drafts on the server and sends them after remount", async () => {
    let workspace: WorkspaceStateWithComposerDrafts = buildInitialWorkspaceState();
    let runPrompt = "";
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        workspace = JSON.parse(String(init.body)) as WorkspaceStateWithComposerDrafts;
        return Response.json(workspace);
      }
      if (path === "/api/run") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { readonly prompt?: string };
        runPrompt = body.prompt ?? "";
        return new Response(`${JSON.stringify({ type: "done" })}\n`, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    const firstRender = renderWithThemeAndVirtuoso(<WorkspacePage />);
    await screen.findByPlaceholderText(/^Написать:/);
    const file = new File(["hello from persisted file"], "notes.txt", { type: "text/plain" });

    fireEvent.change(screen.getByLabelText("Выбрать файлы"), { target: { files: [file] } });

    await waitFor(() => {
      expect(workspace.composerDrafts?.["chat-2"]?.attachments[0]).toMatchObject({
        name: "notes.txt",
        type: "text/plain",
        content: "hello from persisted file",
      });
    });

    firstRender.unmount();
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/^Написать:/), { target: { value: "Read attachment" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(runPrompt).toContain("Read attachment");
      expect(runPrompt).toContain("<attachment name=\"notes.txt\" type=\"text/plain\">");
      expect(runPrompt).toContain("hello from persisted file");
      expect(workspace.composerDrafts?.["chat-2"]).toEqual({ text: "", attachments: [] });
    });
  });

  it("shows a toast when a locally started run completes", async () => {
    let activeRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const notifications: Array<{ readonly title: string; readonly options?: NotificationOptions }> = [];
    class MockNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, options });
      }
    }
    vi.stubGlobal("Notification", MockNotification);
    let workspace = {
      ...buildInitialWorkspaceState(),
      chats: buildInitialWorkspaceState().chats.map((chat) =>
        chat.id === "chat-2" ? { ...chat, status: "idle" as const } : chat,
      ),
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        workspace = JSON.parse(String(init.body)) as typeof workspace;
        return Response.json(workspace);
      }
      if (path === "/api/run") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "text", text: "ok" })}\n`));
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Остановить запуск" })).not.toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/^Написать:/);
    fireEvent.change(input, { target: { value: "Notify me" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Остановить запуск" })).toBeInTheDocument();
    });
    // Switch away so the run completes in the background — a focused "done" is
    // intentionally silent, but background completions still notify.
    fireEvent.click(screen.getByText("Объясни auth flow"));
    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`));
    activeRunController?.close();

    expect(await screen.findByText("Запуск завершён: Release notes для 0.1.69")).toBeInTheDocument();
    expect(notifications).toContainEqual({
      title: "Запуск завершён",
      options: { body: "Release notes для 0.1.69" },
    });
  });

  it("keeps a locally started run notifiable after needs-input and shows the completion toast", async () => {
    let activeRunController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const notifications: Array<{ readonly title: string; readonly options?: NotificationOptions }> = [];
    class MockNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, options });
      }
    }
    vi.stubGlobal("Notification", MockNotification);
    let workspace = {
      ...buildInitialWorkspaceState(),
      chats: buildInitialWorkspaceState().chats.map((chat) =>
        chat.id === "chat-2" ? { ...chat, status: "idle" as const } : chat,
      ),
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        workspace = JSON.parse(String(init.body)) as typeof workspace;
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/run-approval") {
        return Response.json({ id: "approval-1", decision: "approved" });
      }
      if (path === "/api/run") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeRunController = controller;
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Остановить запуск" })).not.toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/^Написать:/);
    fireEvent.change(input, { target: { value: "Ask before running tests" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Остановить запуск" })).toBeInTheDocument();
    });

    activeRunController?.enqueue(
      new TextEncoder().encode(`${JSON.stringify({ type: "approval", id: "approval-1", title: "Approve Bash command?", detail: "npm test" })}\n`),
    );

    expect(await screen.findByText("Агент ждёт ввод: Release notes для 0.1.69")).toBeInTheDocument();
    expect(notifications).toContainEqual({
      title: "Агент ждёт ввод",
      options: { body: "Release notes для 0.1.69" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Одобрить" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/run-approval",
        expect.objectContaining({
          body: JSON.stringify({ id: "approval-1", decision: "approved" }),
          method: "POST",
        }),
      );
    });

    // Switch away so the post-approval completion lands in the background.
    fireEvent.click(screen.getByText("Объясни auth flow"));
    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "text", text: "done after approval" })}\n`));
    activeRunController?.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "done" })}\n`));
    activeRunController?.close();

    expect(await screen.findByText("Запуск завершён: Release notes для 0.1.69")).toBeInTheDocument();
    expect(notifications).toContainEqual({
      title: "Запуск завершён",
      options: { body: "Release notes для 0.1.69" },
    });
  });

  it("shows a stop button for a running conversation", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByRole("button", { name: "Остановить запуск" })).toBeInTheDocument();
  });

  it("shows a stop button when the selected thread still has live agent work", async () => {
    let workspace: WorkspaceStateWithComposerDrafts = buildInitialWorkspaceState();
    workspace = {
      ...workspace,
      chats: workspace.chats.map((conversation) =>
        conversation.id === workspace.selectedId ? { ...conversation, status: "done", activeRunId: undefined } : conversation,
      ),
      threads: {
        ...workspace.threads,
        [workspace.selectedId]: [
          ...(workspace.threads[workspace.selectedId] ?? []),
          {
            id: "a-live-search",
            role: "agent",
            time: "12:00",
            blocks: [{ kind: "search", query: "**/*calculator*", state: "running", results: [] }],
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        const activeRuns = activeRunsResponse(path);
        if (activeRuns) {
          return activeRuns;
        }
        if (path === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json(workspace);
        }
        if (path === "/api/workspace" && init?.method === "PUT") {
          workspace = JSON.parse(String(init.body)) as WorkspaceStateWithComposerDrafts;
          return Response.json(workspace);
        }
        if (path === "/api/project-files") {
          return Response.json({ files: [] });
        }
        if (path === "/api/agent-config") {
          return Response.json({ agents: {} });
        }
        return Response.json({});
      }),
    );

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByRole("button", { name: "Остановить запуск" })).toBeInTheDocument();
  });

  it("retries loading workspace state after a workspace API error", async () => {
    const workspace = buildInitialWorkspaceState();
    let loadAttempts = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        loadAttempts += 1;
        return loadAttempts === 1 ? new Response("unavailable", { status: 503 }) : Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByText("Ошибка Workspace API: Workspace load failed (503)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveStyle({ alignItems: "center" });
    expect(screen.queryByText("Release notes для 0.1.69")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));

    await waitFor(() => {
      expect(loadAttempts).toBe(2);
      expect(screen.queryByText(/Ошибка Workspace API/)).not.toBeInTheDocument();
    });
  });

  it("copies message text from the conversation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Скопировать сообщение" })[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Собери черновик release notes для 0.1.69 по merged PR.");
    });
  });

  it("forks the conversation from an agent message action", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Форкнуть диалог" }));

    expect(await screen.findByText("Форк диалога создан")).toBeInTheDocument();
    expect(screen.getAllByText("Форк: Release notes для 0.1.69").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Написать: CX")).toBeInTheDocument();
  });

  it("posts approval decisions from streamed approval cards", async () => {
    const workspace = {
      ...buildInitialWorkspaceState(),
      selectedId: "chat-2",
      threads: {
        ...buildInitialWorkspaceState().threads,
        "chat-2": [
          {
            id: "a-approval",
            role: "agent" as const,
            blocks: [{ kind: "approval" as const, id: "approval-1", title: "Approve Bash command?", detail: "npm test" }],
          },
        ],
      },
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/run-approval") {
        return Response.json({ id: "approval-1", decision: "approved" });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Одобрить" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/run-approval",
        expect.objectContaining({
          body: JSON.stringify({ id: "approval-1", decision: "approved" }),
          method: "POST",
        }),
      );
    });
  });

  it("posts option selections from streamed question cards", async () => {
    const workspace = {
      ...buildInitialWorkspaceState(),
      selectedId: "chat-2",
      threads: {
        ...buildInitialWorkspaceState().threads,
        "chat-2": [
          {
            id: "a-options",
            role: "agent" as const,
            blocks: [
              {
                kind: "options" as const,
                id: "toolu_question:q0",
                prompt: "How should I format the output?",
                options: [
                  { id: "Summary", label: "Summary", description: "Brief overview" },
                  { id: "Detailed", label: "Detailed", description: "Full explanation" },
                ],
              },
            ],
          },
        ],
      },
    };
    let savedWorkspace = workspace;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(savedWorkspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        savedWorkspace = JSON.parse(String(init.body)) as typeof savedWorkspace;
        return Response.json(savedWorkspace);
      }
      if (path === "/api/run-input") {
        return Response.json({ id: "toolu_question:q0", selected: ["Summary"] });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(await screen.findByText("Summary"));
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/run-input",
        expect.objectContaining({
          body: JSON.stringify({ id: "toolu_question:q0", selected: ["Summary"] }),
          method: "POST",
        }),
      );
      expect(screen.getByText("Выбрано: Summary")).toBeInTheDocument();
    });
  });

  it("does not mark an approval as decided when the approval endpoint fails", async () => {
    const workspace = {
      ...buildInitialWorkspaceState(),
      selectedId: "chat-2",
      threads: {
        ...buildInitialWorkspaceState().threads,
        "chat-2": [
          {
            id: "a-approval",
            role: "agent" as const,
            blocks: [{ kind: "approval" as const, id: "approval-1", title: "Approve Bash command?", detail: "npm test" }],
          },
        ],
      },
    };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/run-approval") {
        return Response.json({ error: "Live approval decisions are not supported by the current agent adapter." }, { status: 501 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Одобрить" }));

    expect(await screen.findByText("Live approval decisions are not supported by the current agent adapter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Одобрить" })).toBeInTheDocument();
    expect(screen.queryByText("Одобрено")).not.toBeInTheDocument();
  });

  it("opens the Git panel for the selected project", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({
          branch: "main",
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
          clean: false,
          files: [{ code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true }],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/git-status",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    // The Git view shows the current branch.
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getAllByText("src/auth.ts").length).toBeGreaterThan(0);
  });

  it("shows an explicit Git API status error when the backend omits an error message", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({}, { status: 500 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    expect(await screen.findByText("Git status failed (500)")).toBeInTheDocument();
  });

  it("shows a selected file diff and stages the file from the Git panel", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({
          branch: "main",
          ahead: 0,
          behind: 0,
          clean: false,
          files: [{ code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true }],
        });
      }
      if (path === "/api/git-diff") {
        return Response.json({ path: "src/auth.ts", mode: "worktree", diff: "@@ -1 +1 @@\n-old\n+new" });
      }
      if (path === "/api/git-stage") {
        return Response.json({
          branch: "main",
          ahead: 0,
          behind: 0,
          clean: true,
          files: [],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    // The unstaged tab lists each changed file as a card that loads and (for a
    // small diff) auto-expands its diff — no separate file selection needed.
    expect(await screen.findByText(/@@ -1 \+1 @@/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Добавить в индекс src/auth.ts" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/git-stage",
        expect.objectContaining({
          body: JSON.stringify({ cwd: "/root/workspace/rlab", path: "src/auth.ts" }),
          method: "POST",
        }),
      );
    });
  });

  it("keeps a large diff collapsed by default and opens it on demand", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const bigDiff = ["@@ -1 +1 @@", ...Array.from({ length: 300 }, (_, index) => `+addedLine${index}`)].join("\n");
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: false, files: [{ code: " M", label: "Modified", path: "src/big.ts", gitPath: "src/big.ts", staged: false, unstaged: true }] });
      }
      if (path === "/api/git-diff") {
        return Response.json({ path: "src/big.ts", mode: "worktree", diff: bigDiff });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    // The card header (file path) shows, but a large diff stays collapsed.
    const header = await screen.findByText("src/big.ts");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/git-diff", expect.anything()));
    expect(screen.queryByText("addedLine0")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(await screen.findByText("addedLine0")).toBeInTheDocument();
  });

  it("shows an error instead of rendering a gigantic diff", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const giganticDiff = ["@@ -1 +1 @@", ...Array.from({ length: 2100 }, (_, index) => `+hugeLine${index}`)].join("\n");
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: false, files: [{ code: " M", label: "Modified", path: "src/huge.ts", gitPath: "src/huge.ts", staged: false, unstaged: true }] });
      }
      if (path === "/api/git-diff") {
        return Response.json({ path: "src/huge.ts", mode: "worktree", diff: giganticDiff });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    const header = await screen.findByText("src/huge.ts");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/git-diff", expect.anything()));
    fireEvent.click(header);

    expect(await screen.findByText(/слишком большой/i)).toBeInTheDocument();
    expect(screen.queryByText("hugeLine0")).not.toBeInTheDocument();
  });

  it("groups Git file changes into unstaged and staged tabs with mode-specific diffs", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const diffRequests: Array<{ readonly cwd?: string; readonly path?: string; readonly mode?: string }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({
          branch: "main",
          ahead: 0,
          behind: 0,
          clean: false,
          files: [
            { code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true },
            { code: "M ", label: "Modified", path: "src/session.ts", gitPath: "src/session.ts", staged: true, unstaged: false },
          ],
        });
      }
      if (path === "/api/git-diff") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string; path?: string; mode?: string };
        diffRequests.push(body);
        const diff = body.mode === "staged" ? "@@ -1 +1 @@\n-stagedOld\n+stagedNew" : "@@ -1 +1 @@\n-worktreeOld\n+worktreeNew";
        return Response.json({ path: body.path, mode: body.mode, diff });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    expect(await screen.findByRole("tab", { name: /^Непоставленные 1$/i })).toHaveAttribute("aria-selected", "true");
    expect((await screen.findAllByText("src/auth.ts")).length).toBeGreaterThan(0);
    expect(await screen.findByText("worktreeOld")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^Поставленные 1$/i }));

    expect((await screen.findAllByText("src/session.ts")).length).toBeGreaterThan(0);
    expect(await screen.findByText("stagedOld")).toBeInTheDocument();
    expect(diffRequests).toContainEqual({ cwd: "/root/workspace/rlab", path: "src/auth.ts", mode: "worktree" });
    expect(diffRequests).toContainEqual({ cwd: "/root/workspace/rlab", path: "src/session.ts", mode: "staged" });
  }, 15_000);

  it("shows last-turn file changes in the Git panel without requesting a Git diff", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: true, files: [] });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("tab", { name: /Последний ход 1/i }));

    expect((await screen.findAllByText("test/auth/login.test.ts")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/useFakeTimers/).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalledWith("/api/git-diff", expect.anything());
  });

  it("commits staged files from the Git panel with an explicit message", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    let commitRequest: { readonly cwd?: string; readonly message?: string } | null = null;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({
          branch: "main",
          ahead: 0,
          behind: 0,
          clean: false,
          files: [{ code: "M ", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: true, unstaged: false }],
        });
      }
      if (path === "/api/git-commit") {
        commitRequest = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string; message?: string };
        return Response.json({
          branch: "main",
          ahead: 1,
          behind: 0,
          clean: true,
          files: [],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Коммит" }));

    const messageInput = await screen.findByLabelText("Сообщение коммита");
    expect(screen.getByRole("button", { name: "Создать коммит" })).toBeDisabled();

    fireEvent.change(messageInput, { target: { value: "Fix auth login test" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать коммит" }));

    await waitFor(() => {
      expect(commitRequest).toEqual({ cwd: "/root/workspace/rlab", message: "Fix auth login test" });
      // A successful commit clears the message field.
      expect(messageInput).toHaveValue("");
    });
  });

  it("adds a diff-line comment and sends it as a review block in the thread", async () => {
    const workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: false, files: [{ code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true }] });
      }
      if (path === "/api/git-diff") {
        return Response.json({ path: "src/auth.ts", mode: "worktree", diff: "@@ -1 +1 @@\n+needsRefactor" });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    // The small diff auto-opens; click a line to attach a review comment.
    fireEvent.click(await screen.findByText("needsRefactor"));
    const commentInput = await screen.findByLabelText("Комментарий агенту...");
    fireEvent.change(commentInput, { target: { value: "вынести в хелпер" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    // The pending-comment tag appears above the composer; send it to the thread.
    fireEvent.click(await screen.findByRole("button", { name: "Отправить комментарии" }));

    // The review renders as a collapsible block (not plain text) in the chat.
    expect(await screen.findByText("Ревью · 1 комментариев")).toBeInTheDocument();
  });

  it("runs a command in the Terminal tab and streams its output", async () => {
    const base = buildInitialWorkspaceState();
    const workspace = { ...base, selectedId: "c-flaky", settings: { ...base.settings, appearance: { ...base.settings.appearance, showTerminal: true } } };
    let terminalRequest: { readonly cwd?: string; readonly command?: string } | null = null;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/workspace" && init?.method === "PUT") {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: true, files: [] });
      }
      if (path === "/api/terminal") {
        terminalRequest = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string; command?: string };
        return new Response(
          `${JSON.stringify({ type: "out", chunk: "hello-from-shell\n" })}\n${JSON.stringify({ type: "exit", code: 0 })}\n`,
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("Написать: CC");
    fireEvent.click(screen.getByRole("button", { name: "Терминал" }));

    const input = await screen.findByPlaceholderText("Выполнить команду...");
    fireEvent.change(input, { target: { value: "echo hi" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("hello-from-shell")).toBeInTheDocument();
    expect(terminalRequest).toEqual({ cwd: "/root/workspace/rlab", command: "echo hi" });
  });

});
