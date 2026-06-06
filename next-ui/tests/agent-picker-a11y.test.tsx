import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPicker, AgentStatusProvider, DEFAULT_PROFILE } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("AgentPicker a11y", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels the dialog and lists the available agents", () => {
    renderWithTheme(
      <AgentPicker
        open
        value={DEFAULT_PROFILE}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Выбор агента" })).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("does not allow selecting agents without a RUN adapter", async () => {
    renderWithTheme(
      <AgentPicker
        open
        value={DEFAULT_PROFILE}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("AMP"));

    expect(await screen.findByText("AMP установлен, но в этом UI для него ещё нет RUN-адаптера.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Использовать AMP" })).toBeDisabled();
  });

  it("selects an agent discovered from the local CLI payload", async () => {
    const onSelect = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agents") {
          return Response.json({
            codex: {
              status: "available",
              bins: ["codex"],
              resolvedBin: "C:\\tools\\codex.cmd",
              runAdapter: true,
              selectable: true,
              env: ["OPENAI_API_KEY", "CODEX_API_KEY"],
              installCommand: "npm install -g @openai/codex@latest",
            },
          });
        }
        return Response.json({});
      }),
    );

    renderWithTheme(
      <AgentStatusProvider>
        <AgentPicker
          open
          value={DEFAULT_PROFILE}
          onClose={vi.fn()}
          onSelect={onSelect}
        />
      </AgentStatusProvider>,
    );

    expect(await screen.findByText("CLI-путь: C:\\tools\\codex.cmd")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать Codex из CLI" }));
    fireEvent.click(screen.getByRole("button", { name: "Использовать Codex" }));

    expect(onSelect).toHaveBeenCalledWith({ agent: "codex", model: "default", reasoning: "default", mode: "default" });
  });

  it("exposes model and reasoning options but no work-mode control (mode is a chat option)", () => {
    renderWithTheme(<AgentPicker open value={DEFAULT_PROFILE} onClose={vi.fn()} onSelect={vi.fn()} />);

    // Claude's model + reasoning options are present...
    expect(screen.getByRole("button", { name: "Opus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" })).toBeInTheDocument();
    // ...but the work-mode option ("Plan") is no longer in the picker.
    expect(screen.queryByRole("button", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("exposes concrete Gemini CLI and OpenCode model choices", () => {
    renderWithTheme(<AgentPicker open value={DEFAULT_PROFILE} onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Выбрать Gemini из CLI" }));

    expect(screen.getByRole("button", { name: "Gemini 3 Pro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flash-Lite" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать OpenCode из CLI" }));

    expect(screen.getByRole("button", { name: "GPT-5.1 Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Sonnet 4.5" })).toBeInTheDocument();
  });
});
