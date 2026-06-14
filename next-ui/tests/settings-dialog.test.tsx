import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStatusProvider } from "../src/components/agent";
import { SettingsDialog } from "../src/components/settings/SettingsDialog";
import { defaultAppSettings } from "../src/lib/app-settings";
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

  it("saves a voice provider API key to the server config endpoint", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      if (path === "/api/agent-config") {
        return Response.json({ agents: {} });
      }
      if (path === "/api/voice-config" && (!init || init.method === "GET")) {
        return Response.json({
          providers: {
            openai: { envVar: "OPENAI_API_KEY", configured: false },
          },
        });
      }
      if (path === "/api/voice-config" && init?.method === "PUT") {
        return Response.json({ ok: true });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetch);
    const onVoiceConfigChange = vi.fn();

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
        onVoiceConfigChange={onVoiceConfigChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Голос" }));
    fireEvent.click(await screen.findByRole("button", { name: "API-ключ для OpenAI Speech-to-Text" }));
    fireEvent.change(screen.getByLabelText("OPENAI_API_KEY"), { target: { value: "sk-voice" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/voice-config",
        expect.objectContaining({
          body: JSON.stringify({ provider: "openai", apiKey: "sk-voice" }),
          method: "PUT",
        }),
      );
    });
    expect(await screen.findByText("Ключ OpenAI Speech-to-Text сохранён")).toBeInTheDocument();
    expect(onVoiceConfigChange).toHaveBeenCalledTimes(1);
  });

  it("syncs voice recognition language from the general language setting", async () => {
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

    fireEvent.click(screen.getByRole("tab", { name: "Общие" }));
    fireEvent.click(screen.getByRole("button", { name: "Английский" }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      general: {
        locale: "en",
        voice: {
          ...defaultAppSettings.general.voice,
          language: "en-US",
        },
      },
    });
  });

  it("places the voice language field before the provider hint and uses a muted microphone icon for disabled voice input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agent-config" || path === "/api/voice-config") {
          return Response.json(path === "/api/voice-config" ? { providers: {} } : { agents: {} });
        }
        return Response.json({});
      }),
    );

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Голос" }));

    const languageField = screen.getByLabelText("Язык распознавания");
    const providerHint = screen.getByText("Выберите провайдер диктовки для композера. Если провайдер не выбран, микрофон скрыт.");
    expect(languageField.compareDocumentPosition(providerHint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("voice-provider-none-icon")).toBeInTheDocument();
  });

  it("marks cloud voice providers as alpha without marking disabled or browser providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agent-config" || path === "/api/voice-config") {
          return Response.json(path === "/api/voice-config" ? { providers: {} } : { agents: {} });
        }
        return Response.json({});
      }),
    );

    renderWithTheme(
      <SettingsDialog
        open
        onClose={vi.fn()}
        settings={defaultAppSettings}
        onSettingsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Голос" }));

    const disabledCard = screen.getByText("No voice input").closest(".MuiStack-root");
    const browserCard = screen.getByText("Browser Web Speech").closest(".MuiStack-root");
    const openAiCard = screen.getByText("OpenAI Speech-to-Text").closest(".MuiStack-root");

    expect(screen.getAllByText("Альфа-версия")).toHaveLength(5);
    expect(disabledCard).not.toHaveTextContent("Альфа-версия");
    expect(browserCard).not.toHaveTextContent("Альфа-версия");
    expect(openAiCard).toHaveTextContent("Альфа-версия");
  });

  it("reports a completed install request for unavailable agents", async () => {
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
    expect(await screen.findByText("OpenCode установлен: npm install -g opencode-ai")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "GPT-5.5" }));

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

  it("does not expose agent runtime modes in general settings", async () => {
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

    expect(screen.queryByText("Доступ к файлам")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Только чтение" })).not.toBeInTheDocument();
    expect(onSettingsChange).not.toHaveBeenCalled();
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
