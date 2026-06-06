import { fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { buildInitialWorkspaceState, type WorkspaceState } from "../src/components/workspace/workspace-state";

let workspace: WorkspaceState;

describe("hash routing", () => {
  beforeEach(() => {
    workspace = buildInitialWorkspaceState();
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
    expect(await screen.findByPlaceholderText("Написать: Объясни auth flow...")).toBeInTheDocument();
  });

  it("opens a project conversation deep link", async () => {
    window.location.hash = "#/project/auth-service/c-jwt";

    renderApp();

    expect((await screen.findAllByText("Ротация JWT-секретов")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Ждёт подтверждение deploy")).toBeInTheDocument();
  });

  it("updates the hash when a project conversation is selected", async () => {
    window.location.hash = "#/project/auth-service/c-flaky";

    renderApp();
    await screen.findByPlaceholderText("Написать: Flaky-тест auth.login...");

    fireEvent.click(screen.getByText("Ротация JWT-секретов"));

    expect(window.location.hash).toBe("#/project/auth-service/c-jwt");
  });
});

function renderApp() {
  return render(<App />);
}

async function fetchWorkspaceResource(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestPath(input);
  const method = init?.method ?? "GET";

  if (url === "/api/workspace" && method === "GET") {
    return Response.json(workspace);
  }

  if (url === "/api/workspace" && method === "PUT") {
    workspace = JSON.parse(String(init?.body)) as WorkspaceState;
    return Response.json(workspace);
  }

  if (url === "/api/project-files") {
    return Response.json({ files: [] });
  }

  if (url === "/api/agents") {
    return Response.json({ "claude-code": "available" });
  }

  if (url === "/api/agent-config") {
    return Response.json({ agents: {} });
  }

  throw new Error(`Unexpected test fetch: ${method} ${url}`);
}

function requestPath(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("/") ? url : new URL(url).pathname;
}
