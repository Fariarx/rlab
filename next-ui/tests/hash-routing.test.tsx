import { fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { buildInitialWorkspaceState } from "../src/lib/workspace-state";
import { createWorkspaceApiFixture, requestPath, type WorkspaceApiFixture } from "./util/workspace-api";
import { withVirtuosoMock } from "./util/render-with-virtuoso";

let workspaceApi: WorkspaceApiFixture;

describe("hash routing", () => {
  beforeEach(() => {
    workspaceApi = createWorkspaceApiFixture(buildInitialWorkspaceState());
    vi.stubGlobal("fetch", vi.fn(fetchWorkspaceResource));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("opens a chat deep link", async () => {
    window.location.hash = "#/chat/chat-1";

    renderApp();

    expect(screen.getAllByText("Объясни auth flow").length).toBeGreaterThan(0);
    expect(await screen.findByPlaceholderText("Написать: Claude Code")).toBeInTheDocument();
  });

  it("opens a project conversation deep link", async () => {
    window.location.hash = "#/project/auth-service/c-jwt";

    renderApp();

    expect((await screen.findAllByText("Ротация JWT-секретов")).length).toBeGreaterThan(0);
    expect(await screen.findByPlaceholderText(/Написать: Codex/)).toBeInTheDocument();
  });

  it("opens a project deep link at the first project conversation", async () => {
    window.location.hash = "#/project/auth-service";

    renderApp();

    expect((await screen.findAllByText("Flaky-тест auth.login")).length).toBeGreaterThan(0);
    expect(await screen.findByPlaceholderText("Написать: Claude Code")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/project/auth-service");
  });

  it("updates the hash when a project conversation is selected", async () => {
    window.location.hash = "#/project/auth-service/c-flaky";

    renderApp();
    await screen.findByPlaceholderText("Написать: Claude Code");

    fireEvent.click(screen.getByText("Ротация JWT-секретов"));

    expect(window.location.hash).toBe("#/project/auth-service/c-jwt");
  });

  it("creates a new conversation inside the active project route", async () => {
    window.location.hash = "#/project/auth-service/c-flaky";

    renderApp();
    await screen.findByPlaceholderText("Написать: Claude Code");

    fireEvent.click(screen.getByRole("button", { name: "Новый диалог" }));
    const input = await screen.findByPlaceholderText("Написать: Claude Code");
    fireEvent.change(input, { target: { value: "Project-local follow-up" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const project = workspaceApi.state.projects.find((item) => item.id === "auth-service");
    const created = project?.conversations.find((conversation) => conversation.snippet === "Project-local follow-up");
    expect(created).toBeDefined();
    expect(workspaceApi.state.chats.some((conversation) => conversation.snippet === "Project-local follow-up")).toBe(false);
    expect(window.location.hash).toBe(`#/project/auth-service/${created?.id}`);
  });
});

function renderApp() {
  return render(withVirtuosoMock(<App />));
}

async function fetchWorkspaceResource(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestPath(input);
  const method = init?.method ?? "GET";
  const workspaceResponse = workspaceApi.handle(input, init);
  if (workspaceResponse) {
    return workspaceResponse;
  }

  if (url === "/api/project-files") {
    return Response.json({ files: [] });
  }

  if (url === "/api/runs") {
    return Response.json({ runs: [] });
  }

  if (url === "/api/agents") {
    return Response.json({ "claude-code": "available" });
  }

  if (url === "/api/agent-config") {
    return Response.json({ agents: {} });
  }

  throw new Error(`Unexpected test fetch: ${method} ${url}`);
}
