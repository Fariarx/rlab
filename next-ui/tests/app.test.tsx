import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { buildInitialWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";
import { applyWorkspaceMutationRequest, isWorkspaceMutationRequest } from "./util/workspace-api";
import { withVirtuosoMock } from "./util/render-with-virtuoso";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the localized agent workspace by default", () => {
    render(withVirtuosoMock(<App />));

    expect(screen.getByText("rlab / агенты")).toBeInTheDocument();
    // Projects and chats share one unified sidebar list (no mode toggle).
    expect(screen.getByText("auth-service")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Поиск диалогов..." })).toBeInTheDocument();
  });

  it("shows an explicit empty-agent state when live detection finds no agents", async () => {
    let state: WorkspaceState = buildInitialWorkspaceState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json(state);
        }
        if (isWorkspaceMutationRequest(path, init)) {
          state = applyWorkspaceMutationRequest(state, init);
          return Response.json({ ok: true, revision: 1 });
        }
        if (path === "/api/agents") {
          return Response.json({
            "claude-code": "unavailable",
            codex: "unavailable",
            gemini: "unavailable",
            amp: "unavailable",
            opencode: "unavailable",
            cursor: "unavailable",
            qwen: "unavailable",
            copilot: "unavailable",
            droid: "unavailable",
          });
        }
        return Response.json({});
      }),
    );

    render(withVirtuosoMock(<App />));

    expect(await screen.findByText("На этой машине нет установленных или доступных coding-агентов.")).toBeInTheDocument();
  });

  it("shows and retries agent detection API failures", async () => {
    let state: WorkspaceState = buildInitialWorkspaceState();
    let agentAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json(state);
        }
        if (isWorkspaceMutationRequest(path, init)) {
          state = applyWorkspaceMutationRequest(state, init);
          return Response.json({ ok: true, revision: 1 });
        }
        if (path === "/api/agents") {
          agentAttempts += 1;
          if (agentAttempts === 1) {
            return new Response("unavailable", { status: 503 });
          }
          return Response.json({
            "claude-code": "available",
            codex: "unavailable",
            gemini: "unavailable",
            amp: "unavailable",
            opencode: "unavailable",
            cursor: "unavailable",
            qwen: "unavailable",
            copilot: "unavailable",
            droid: "unavailable",
          });
        }
        return Response.json({});
      }),
    );

    render(withVirtuosoMock(<App />));

    expect(await screen.findByText("Ошибка детекта агентов: Agent detection failed (503)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку агентов" }));

    await waitFor(() => {
      expect(agentAttempts).toBe(2);
      expect(screen.queryByText(/Ошибка детекта агентов/)).not.toBeInTheDocument();
    });
  });

  it("loads live agent statuses without MobX action warnings", async () => {
    let state: WorkspaceState = buildInitialWorkspaceState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/workspace" && (!init || init.method === "GET")) {
          return Response.json(state);
        }
        if (isWorkspaceMutationRequest(path, init)) {
          state = applyWorkspaceMutationRequest(state, init);
          return Response.json({ ok: true, revision: 1 });
        }
        if (path === "/api/agents") {
          return Response.json({
            "claude-code": "unavailable",
            codex: "available",
            gemini: "unavailable",
            amp: "unavailable",
            opencode: "unavailable",
            cursor: "unavailable",
            qwen: "unavailable",
            copilot: "unavailable",
            droid: "unavailable",
          });
        }
        return Response.json({});
      }),
    );

    render(withVirtuosoMock(<App />));

    // The selected chat's agent (codex → available) is shown as the header
    // agent badge's status dot, whose accessible label reflects the live status.
    expect((await screen.findAllByLabelText("Доступен")).length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("[MobX]"));
  });

  it("disables app animations when reduce motion is enabled", async () => {
    const state: WorkspaceState = {
      ...buildInitialWorkspaceState(),
      settings: {
        ...buildInitialWorkspaceState().settings,
        appearance: {
          ...buildInitialWorkspaceState().settings.appearance,
          reduceMotion: true,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/workspace") {
          return Response.json(state);
        }
        return Response.json({});
      }),
    );

    render(withVirtuosoMock(<App />));

    expect(await screen.findByText("rlab / агенты")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.head.textContent).toContain("animation:none!important");
      expect(document.head.textContent).toContain("transition:none!important");
    });
  });
});
