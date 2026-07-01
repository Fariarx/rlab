import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/components/workspace/terminal/TerminalView", () => ({
  TerminalView: ({ cwd }: { readonly cwd?: string }) => <div data-testid="terminal-cwd">{cwd ?? "none"}</div>,
}));

import { App } from "../src/App";
import { WorkspacePage } from "../src/components/workspace/WorkspacePage";
import { buildInitialWorkspaceState } from "../src/lib/workspace-state";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";
import { applyWorkspaceMutationRequest, createWorkspaceApiFixture, isWorkspaceMutationRequest, requestPath } from "./util/workspace-api";

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
    window.location.hash = "";
    const workspaceApi = createWorkspaceApiFixture(buildInitialWorkspaceState());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(url);
        const activeRuns = activeRunsResponse(path);
        if (activeRuns) {
          return activeRuns;
        }
        const workspaceResponse = workspaceApi.handle(url, init);
        if (workspaceResponse) {
          return workspaceResponse;
        }
        if (path === "/api/project-files") {
          return Response.json({ files: [] });
        }
        if (path === "/api/git-status") {
          return Response.json({ branch: "main", branches: ["main"], ahead: 0, behind: 0, clean: true, files: [] });
        }
        if (path === "/api/list-directories") {
          return Response.json({ path: "/root/workspace/rlab", parent: "/root/workspace", entries: [] });
        }
        if (path === "/api/folder-info") {
          return Response.json({ path: "/root/workspace/rlab", name: "rlab" });
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
    window.location.hash = "";
    vi.unstubAllGlobals();
  });

  it("renders the sidebar, chats list, and conversation thread", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(screen.getByText("rlab / агенты")).toBeInTheDocument();
    // Appears in both the sidebar row and the pane header.
    expect(screen.getAllByText(/Release notes для 0\.1\.69/i).length).toBeGreaterThan(0);
    // Default conversation thread (release notes) is rendered in the pane.
    expect(await screen.findByText(/по merged PR/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Чат / Git / Ресурсы")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Просмотр" })).not.toBeInTheDocument();
  });

  it("shows projects in the unified sidebar list", () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("shows full selected agent model and reasoning labels in the composer placeholder", async () => {
    const workspace = buildInitialWorkspaceState();
    const profile = { agent: "codex", model: "gpt-5.5", reasoning: "xhigh", mode: "default" } as const;
    const selectedId = workspace.selectedId;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json({
          ...workspace,
          chats: workspace.chats.map((chat) => (chat.id === selectedId ? { ...chat, agent: "codex", profile } : chat)),
        });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", branches: ["main"], ahead: 0, behind: 0, clean: true, files: [] });
      }
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByPlaceholderText("codex/gpt-5.5/xhigh")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("C/G")).not.toBeInTheDocument();
  });

  it("shows a bottom sidebar notice when a CLI update is available", async () => {
    const workspace = buildInitialWorkspaceState();
    const installRequests: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path.startsWith("/api/cli-updates")) {
        return Response.json({
          checkedAt: Date.now(),
          checking: false,
          updates: [
            {
              agent: "codex",
              agentName: "Codex",
              packageName: "@openai/codex",
              currentVersion: "1.0.0",
              latestVersion: "1.1.0",
              command: "npm install -g @openai/codex@latest",
            },
          ],
          errors: {},
        });
      }
      if (path === "/api/agent-install" && init?.method === "POST") {
        installRequests.push(String(init.body));
        return Response.json({ ok: true, agent: "codex" });
      }
      return Response.json({});
    });

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    expect(await screen.findByText("Нужно обновить CLI")).toBeInTheDocument();
    const toggle = screen.getByTestId("cli-updates-accordion-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await screen.findAllByText("Codex")).length).toBeGreaterThan(0);
    expect(screen.getByText("1.0.0 → 1.1.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));

    await waitFor(() => expect(installRequests).toHaveLength(1));
    expect(JSON.parse(installRequests[0] ?? "{}")).toEqual({ agent: "codex" });
    await waitFor(() => expect(screen.queryByText("Нужно обновить CLI")).not.toBeInTheDocument());
    expect(screen.queryByText("Codex: 1.0.0 -> 1.1.0")).not.toBeInTheDocument();
  });

  it("restores the last opened workspace tab per conversation", async () => {
    const initial = buildInitialWorkspaceState();
    let workspace = {
      ...initial,
      selectedId: "chat-2",
      chats: initial.chats.map((chat) =>
        chat.id === "chat-2" ? { ...chat, view: "git" as const } : chat.id === "chat-3" ? { ...chat, view: "resources" as const } : chat,
      ),
    };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Git" })).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("option", { name: /Postgres или SQLite/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Ресурсы" })).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("option", { name: /Release notes/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Git" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("opens the terminal for a non-project chat in the app workspace directory", async () => {
    const initial = buildInitialWorkspaceState();
    let workspace = {
      ...initial,
      selectedId: "chat-2",
      settings: {
        ...initial.settings,
        appearance: {
          ...initial.settings.appearance,
          showTerminal: true,
        },
      },
    };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByTestId("terminal-cwd");
    fireEvent.click(screen.getByRole("button", { name: "Терминал" }));

    expect(screen.getByTestId("terminal-cwd")).toHaveTextContent(".");
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

    const input = await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.change(input, { target: { value: "Set up CI" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getAllByText("Set up CI").length).toBeGreaterThan(0);
    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("picks a folder before showing the create project form", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));

    expect(await screen.findByRole("dialog", { name: "Выбор папки" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Название проекта")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать эту папку" }));

    expect(screen.getByRole("dialog", { name: "Создать проект" })).toBeInTheDocument();
    expect(screen.getByLabelText("Название проекта")).toHaveValue("rlab");
    expect(screen.getByLabelText("Папка проекта")).toHaveValue("/root/workspace/rlab");

    fireEvent.change(screen.getByLabelText("Название проекта"), { target: { value: "Custom Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(screen.getByText("Custom Project")).toBeInTheDocument());
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    window.location.hash = "#/chat/chat-2";
    renderWithThemeAndVirtuoso(<App />);

    // Projects and chats share one list, so target chat-2's row explicitly
    // rather than relying on which conversation happens to be first.
    const chatRow = await screen.findByRole("option", { name: "Release notes для 0.1.69" });
    fireEvent.click(within(chatRow).getByRole("button", { name: "Действия с диалогом" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить" }));

    await waitFor(() => {
      expect(workspace.chats.some((chat) => chat.id === "chat-2")).toBe(false);
    });
    expect(window.location.hash).not.toBe("#/chat/chat-2");
    expect(workspace.chats.some((chat) => chat.id === workspace.selectedId)).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Удалить диалог?" })).not.toBeInTheDocument();
  });

  it("sends a message into the active conversation", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    const input = await screen.findByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/);
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    const firstRender = renderWithThemeAndVirtuoso(<WorkspacePage />);
    const input = await screen.findByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/);

    fireEvent.change(input, { target: { value: "Черновик не из браузера" } });

    await waitFor(() => {
      expect(workspace.composerDrafts?.["chat-2"]?.text).toBe("Черновик не из браузера");
    });

    firstRender.unmount();
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/)).toHaveValue("Черновик не из браузера");
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    await screen.findByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/);
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
    fireEvent.change(screen.getByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/), { target: { value: "Read attachment" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(runPrompt).toContain("Read attachment");
      expect(runPrompt).toContain("<attachment name=\"notes.txt\" type=\"text/plain\">");
      expect(runPrompt).toContain("hello from persisted file");
      expect(workspace.composerDrafts?.["chat-2"]).toBeUndefined();
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    const input = screen.getByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/);
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    const input = screen.getByPlaceholderText(/^[a-z0-9.-]+(?:\/[a-z0-9.-]+){2}$/);
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
        if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    const workspaceApi = createWorkspaceApiFixture(buildInitialWorkspaceState());
    let loadAttempts = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(url);
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        loadAttempts += 1;
        return loadAttempts === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ ...workspaceApi.state, revision: workspaceApi.revision });
      }
      const workspaceResponse = workspaceApi.handle(url, init);
      if (workspaceResponse) {
        return workspaceResponse;
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Ошибка Workspace API: Workspace load failed (503)")).toBeInTheDocument();
    expect(alert).toHaveStyle({ alignItems: "center" });
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

    const copyButtons = await screen.findAllByRole("button", { name: "Скопировать сообщение" });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Собери черновик release notes для 0.1.69 по merged PR.");
    });
  });

  it("forks the conversation from an agent message action", async () => {
    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Форкнуть диалог" }));

    expect(await screen.findByText("Форк диалога создан")).toBeInTheDocument();
    expect(screen.getAllByText("Fork #1: Release notes для 0.1.69").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("codex/default/default")).toBeInTheDocument();
  });

  it("posts approval decisions from streamed approval cards", async () => {
    let workspace = {
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
      if (isWorkspaceMutationRequest(path, init)) {
        savedWorkspace = applyWorkspaceMutationRequest(savedWorkspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    });
  });

  it("posts free-text answers from streamed question cards", async () => {
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
      if (isWorkspaceMutationRequest(path, init)) {
        savedWorkspace = applyWorkspaceMutationRequest(savedWorkspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/run-input") {
        return Response.json({ id: "toolu_question:q0", selected: ["Use terse bullets"] });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    fireEvent.change(await screen.findByPlaceholderText("Или скажите что не так..."), { target: { value: "Use terse bullets" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить текстом" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/run-input",
        expect.objectContaining({
          body: JSON.stringify({ id: "toolu_question:q0", selected: ["Use terse bullets"] }),
          method: "POST",
        }),
      );
    });
  });

  it("does not mark an approval as decided when the approval endpoint fails", async () => {
    let workspace = {
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({
          branch: "main",
          branches: ["main", "feature/ui"],
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/git-status",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    // The Git view shows the current branch as a switchable label.
    const branchLabel = await screen.findByRole("button", { name: "Переключить ветку" });
    expect(branchLabel).toHaveTextContent("main");
    expect(screen.getAllByText("src/auth.ts").length).toBeGreaterThan(0);
  });

  it("shows the Git commit graph in a separate Git tab", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const treeRequests: Array<{ readonly cwd?: string }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", branches: ["main"], ahead: 0, behind: 0, clean: true, files: [], commitHash: "a1b2c3d" });
      }
      if (path === "/api/git-tree") {
        treeRequests.push(JSON.parse(String(init?.body ?? "{}")) as { cwd?: string });
        return Response.json({
          commits: [
            {
              graph: "*",
              hash: "a1b2c3d4",
              shortHash: "a1b2c3d",
              parents: ["0000000"],
              author: "Luis",
              date: "2026-06-11 09:24:31 +0200",
              refs: ["HEAD -> main", "origin/main"],
              subject: "Refine webhook handling",
            },
            {
              graph: "| *",
              hash: "b2c3d4e5",
              shortHash: "b2c3d4e",
              parents: ["1111111", "2222222"],
              author: "Ada",
              date: "2026-06-10 18:05:44 +0200",
              refs: ["feature/api"],
              subject: "Merge API branch",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("tab", { name: /Граф коммитов/ }));

    expect((await screen.findAllByText("Refine webhook handling")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("git-commit-graph")).toBeInTheDocument();
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("feature/api")).toBeInTheDocument();
    expect(screen.getAllByText("Luis · 2026-06-11 09:24:31 +0200").length).toBeGreaterThan(0);
    const firstCommitRow = (await screen.findAllByTestId("git-commit-row"))[0];
    const firstCommitSubjectButton = within(firstCommitRow).getByText("Refine webhook handling").closest("button");
    if (!firstCommitSubjectButton) {
      throw new Error("Commit subject button not found.");
    }
    fireEvent.click(firstCommitSubjectButton);
    expect(screen.queryByRole("menuitem", { name: "Cherry-pick на текущую ветку" })).not.toBeInTheDocument();
    fireEvent.click(within(firstCommitRow).getByRole("button", { name: "Действия с коммитом a1b2c3d" }));
    expect(await screen.findByRole("menuitem", { name: "Cherry-pick на текущую ветку" })).toBeInTheDocument();
    expect(treeRequests).toEqual([{ cwd: "/root/workspace/rlab" }]);
  });

  it("switches Git branches from the header autocomplete when the worktree is clean", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const checkoutRequests: Array<{ readonly cwd?: string; readonly branch?: string }> = [];
    let branch = "main";
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch, branches: ["main", "feature/ui"], ahead: 0, behind: 0, clean: true, files: [], unstagedAdditions: 0, unstagedDeletions: 0 });
      }
      if (path === "/api/git-checkout") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string; branch?: string };
        checkoutRequests.push(body);
        branch = body.branch ?? branch;
        return Response.json({ branch, branches: ["main", "feature/ui"], ahead: 0, behind: 0, clean: true, files: [], unstagedAdditions: 0, unstagedDeletions: 0 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("button", { name: "Переключить ветку" }));
    fireEvent.click(await screen.findByRole("button", { name: /feature\/ui/ }));

    await waitFor(() => {
      expect(checkoutRequests).toEqual([{ cwd: "/root/workspace/rlab", branch: "feature/ui" }]);
      expect(screen.getByRole("button", { name: "Переключить ветку" })).toHaveTextContent("feature/ui");
    });
  });

  it("confirms before moving a conversation into a worktree", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const createRequests: Array<{ readonly cwd?: string }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(url);
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      if (path === "/api/git-status") {
        return Response.json({ branch: "main", branches: ["main"], ahead: 0, behind: 0, clean: true, files: [], unstagedAdditions: 0, unstagedDeletions: 0 });
      }
      if (path === "/api/git-worktree-create") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string };
        createRequests.push(body);
        return Response.json({ path: "/root/workspace/rlab.worktrees/c-jwt", branch: "kanban/c-jwt" });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("button", { name: "Перенести в ворктри" }));

    expect(createRequests).toEqual([]);
    expect(await screen.findByText("Перенести диалог в ворктри?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    await waitFor(() => {
      expect(createRequests).toEqual([{ cwd: "/root/workspace/rlab" }]);
    });
  });

  it("clears stale worktree Git changes immediately after switching the conversation back to main", async () => {
    const base = buildInitialWorkspaceState();
    const worktreePath = "/root/workspace/rlab.worktrees/wt-stale";
    let workspace = {
      ...base,
      selectedId: "c-flaky",
      projects: base.projects.map((project) =>
        project.id === "auth-service"
          ? {
              ...project,
              conversations: project.conversations.map((conversation) => (conversation.id === "c-flaky" ? { ...conversation, worktreePath } : conversation)),
            }
          : project,
      ),
    };
    let resolveBaseStatus: (response: Response) => void = () => undefined;
    const baseStatusPromise = new Promise<Response>((resolve) => {
      resolveBaseStatus = resolve;
    });
    const gitStatusCwds: string[] = [];
    const mergeRequests: Array<{ readonly base?: string; readonly worktreePath?: string }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
      }
      if (path === "/api/project-files") {
        return Response.json({ files: [] });
      }
      if (path === "/api/git-status") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string };
        gitStatusCwds.push(body.cwd ?? "");
        if (body.cwd === worktreePath) {
          return Response.json({
            branch: "kanban/wt-stale",
            ahead: 0,
            behind: 0,
            clean: false,
            files: [{ code: " M", label: "Modified", path: "src/worktree-only.ts", gitPath: "src/worktree-only.ts", staged: false, unstaged: true }],
            unstagedAdditions: 1,
            unstagedDeletions: 0,
          });
        }
        return baseStatusPromise;
      }
      if (path === "/api/git-diff") {
        return Response.json({ path: "src/worktree-only.ts", mode: "worktree", diff: "@@ -1 +1 @@\n-oldWorktree\n+newWorktree" });
      }
      if (path === "/api/git-worktree-merge") {
        mergeRequests.push(JSON.parse(String(init?.body ?? "{}")) as { base?: string; worktreePath?: string });
        return Response.json({ branch: "main", ahead: 0, behind: 0, clean: true, files: [], unstagedAdditions: 0, unstagedDeletions: 0 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    renderWithThemeAndVirtuoso(<WorkspacePage />);

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    expect(await screen.findByText("src/worktree-only.ts")).toBeInTheDocument();
    expect(await screen.findByText("oldWorktree")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Влить в основной + удалить" }));

    await waitFor(() => {
      expect(mergeRequests).toEqual([{ base: "/root/workspace/rlab", worktreePath }]);
      expect(gitStatusCwds).toContain("/root/workspace/rlab");
      expect(screen.queryByText("src/worktree-only.ts")).not.toBeInTheDocument();
      expect(screen.queryByText("oldWorktree")).not.toBeInTheDocument();
    });

    resolveBaseStatus(Response.json({ branch: "main", ahead: 0, behind: 0, clean: true, files: [], unstagedAdditions: 0, unstagedDeletions: 0 }));
    expect(await screen.findByRole("button", { name: "Переключить ветку" })).toHaveTextContent("main");
  });

  it("shows an explicit Git API status error when the backend omits an error message", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    expect(await screen.findByText("Git status failed (500)")).toBeInTheDocument();
  });

  it("shows a selected file diff and stages the file from the Git panel", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
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

  it("confirms before discarding an unstaged file from the Git panel", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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
      if (path === "/api/git-discard-file") {
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    expect(await screen.findByText(/@@ -1 \+1 @@/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить изменения в src/auth.ts" }));
    const dialog = await screen.findByRole("dialog", { name: "Отменить изменения файла?" });
    expect(within(dialog).getByText(/src\/auth\.ts/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить изменения" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/git-discard-file",
        expect.objectContaining({
          body: JSON.stringify({ cwd: "/root/workspace/rlab", path: "src/auth.ts", untracked: false }),
          method: "POST",
        }),
      );
    });
  });

  it("keeps a large diff collapsed by default and opens it on demand", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    // The card header (file path) shows, but a large diff stays collapsed.
    const header = await screen.findByText("src/big.ts");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/git-diff", expect.anything()));
    expect(screen.queryByText("addedLine0")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(await screen.findByText("addedLine0")).toBeInTheDocument();
  });

  it("shows an error instead of rendering a gigantic diff", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    const header = await screen.findByText("src/huge.ts");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/git-diff", expect.anything()));
    fireEvent.click(header);

    expect(await screen.findByText(/слишком большой/i)).toBeInTheDocument();
    expect(screen.queryByText("hugeLine0")).not.toBeInTheDocument();
  });

  it("groups Git file changes into unstaged and staged tabs with mode-specific diffs", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
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
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("tab", { name: /Последний ход 1/i }));

    expect((await screen.findAllByText("test/auth/login.test.ts")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/useFakeTimers/).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalledWith("/api/git-diff", expect.anything());
  });

  it("commits staged files from the Git panel with an explicit message", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
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
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("tab", { name: /Поставленные/ }));

    const messageInput = await screen.findByLabelText("Сообщение коммита");
    expect(screen.getByRole("button", { name: "Создать коммит" })).toBeDisabled();

    fireEvent.change(messageInput, { target: { value: "Fix auth login test" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать коммит" }));

    await waitFor(() => {
      expect(commitRequest).toEqual({ cwd: "/root/workspace/rlab", message: "Fix auth login test" });
    });
    // The commit form lives at the top of the staged tab and only shows while
    // there are staged files; a successful commit empties staging, so it goes away.
    await waitFor(() => {
      expect(screen.queryByLabelText("Сообщение коммита")).not.toBeInTheDocument();
    });
  });

  it("adds a diff-line comment and sends it as a review block in the thread", async () => {
    let workspace = { ...buildInitialWorkspaceState(), selectedId: "c-flaky" };
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const activeRuns = activeRunsResponse(path);
      if (activeRuns) {
        return activeRuns;
      }
      if (path === "/api/workspace" && (!init || init.method === "GET")) {
        return Response.json(workspace);
      }
      if (isWorkspaceMutationRequest(path, init)) {
        workspace = applyWorkspaceMutationRequest(workspace, init);
        return Response.json({ ok: true, revision: 1 });
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

    await screen.findByPlaceholderText("claude-code/default/default");
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

});
