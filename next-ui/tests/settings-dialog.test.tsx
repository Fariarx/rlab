import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStatusProvider } from "../src/components/agent";
import { SettingsDialog } from "../src/components/settings/SettingsDialog";
import { defaultAppSettings } from "../src/components/workspace/app-settings";
import { renderWithTheme } from "./util/render-with-theme";

describe("SettingsDialog agent configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves an agent API key to the server config endpoint", async () => {
    let agentChecks = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agents") {
        agentChecks += 1;
        return Response.json({ codex: "needs-setup" });
      }
      if (path === "/api/agent-config" && (!init || init.method === "GET")) {
        return Response.json({ agents: { codex: { envVar: "OPENAI_API_KEY", configured: false } } });
      }
      if (path === "/api/agent-config" && init?.method === "PUT") {
        return Response.json({ ok: true });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithTheme(
      <AgentStatusProvider>
        <SettingsDialog
          open
          onClose={vi.fn()}
          settings={defaultAppSettings}
          onSettingsChange={vi.fn()}
        />
      </AgentStatusProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Настройки" })).toBeInTheDocument();

    // The key lives behind a per-agent button + popover now.
    fireEvent.click(await screen.findByRole("button", { name: "API-ключ для Codex" }));
    fireEvent.change(await screen.findByLabelText(/OpenAI API key/), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ключ Codex" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/agent-config",
        expect.objectContaining({
          body: JSON.stringify({ agent: "codex", apiKey: "sk-test" }),
          method: "PUT",
        }),
      );
    });
    expect(await screen.findByText("Ключ Codex сохранён")).toBeInTheDocument();
    await waitFor(() => {
      expect(agentChecks).toBeGreaterThanOrEqual(2);
    });
  });

  it("starts a concrete install request for unavailable agents", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      if (path === "/api/agent-install") {
        return Response.json({ ok: true, command: "npm install -g opencode-ai" });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Установить OpenCode" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/agent-install",
        expect.objectContaining({
          body: JSON.stringify({ agent: "opencode" }),
          method: "POST",
        }),
      );
    });
    expect(await screen.findByText("Установка OpenCode запущена: npm install -g opencode-ai")).toBeInTheDocument();
  });

  it("shows a retryable agent config API error", async () => {
    let attempts = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config" && (!init || init.method === "GET")) {
        attempts += 1;
        if (attempts === 1) {
          return Response.json({ error: "offline" }, { status: 503 });
        }
        return Response.json({ agents: { codex: { envVar: "OPENAI_API_KEY", configured: false } } });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Ошибка настроек агентов: offline")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку настроек агентов" }));

    await waitFor(() => {
      expect(attempts).toBe(2);
      expect(screen.queryByText("Ошибка настроек агентов: offline")).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("button", { name: "API-ключ для Codex" })).toBeInTheDocument();
  });

  it("shows agent install failures instead of silently clearing the pending state", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      if (path === "/api/agent-install") {
        return Response.json({ error: "npm failed" }, { status: 500 });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Установить OpenCode" }));

    expect(await screen.findByText("Ошибка установки OpenCode: npm failed")).toBeInTheDocument();
  });

  it("updates the server-backed default agent model", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);
    const onSettingsChange = vi.fn();

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={{
          ...defaultAppSettings,
          agents: {
            ...defaultAppSettings.agents,
            defaultProfile: {
              agent: "codex",
              model: "default",
              reasoning: "default",
              mode: "default",
            },
          },
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Сделать Codex GPT-5.5 моделью по умолчанию" }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      agents: {
        defaultProfile: {
          agent: "codex",
          model: "gpt-5.5",
          reasoning: "default",
          mode: "default",
        },
      },
    });
  });

  it("updates the server-backed agent filesystem access mode", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);
    const onSettingsChange = vi.fn();

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Без ограничений" }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      agents: {
        accessMode: "unrestricted",
      },
    });
  });

  it("updates the high-contrast theme setting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agent-config") {
          return Response.json({ agents: {} });
        }
        return Response.json({});
      }),
    );
    const onSettingsChange = vi.fn();

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Внешний вид" }));
    fireEvent.click(screen.getByRole("button", { name: "Высокий контраст" }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      appearance: {
        theme: "high-contrast",
      },
    });
  });
});
