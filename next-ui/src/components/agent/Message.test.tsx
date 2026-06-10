import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { appTheme } from "../../theme/app-theme";
import { Message } from "./Message";
import type { ChatMessage } from "./types";

function renderMessage(message: ChatMessage, actions?: Parameters<typeof Message>[0]["actions"], agentProfile?: Parameters<typeof Message>[0]["agentProfile"]) {
  return render(
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        <Message message={message} actions={actions} agentProfile={agentProfile} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("Message", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders retry action for agent messages", () => {
    const onRetry = vi.fn();
    const message: ChatMessage = {
      id: "agent-1",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, { onRetry });

    fireEvent.click(screen.getByRole("button", { name: "Повторить сообщение" }));

    expect(onRetry).toHaveBeenCalledWith(message);
  });

  it("renders fork action for agent messages", () => {
    const onFork = vi.fn();
    const message: ChatMessage = {
      id: "agent-fork",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, { onFork });

    fireEvent.click(screen.getByRole("button", { name: "Форкнуть диалог" }));

    expect(onFork).toHaveBeenCalledWith(message);
  });

  it("renders agent details header as an accessible expandable button", () => {
    const message: ChatMessage = {
      id: "agent-2",
      role: "agent",
      blocks: [{ kind: "reasoning", text: "Проверяю контекст", duration: "2s" }],
    };

    renderMessage(message);

    const disclosure = screen.getByRole("button", { name: /размышление/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the agent details header sticky while expanded", () => {
    const message: ChatMessage = {
      id: "agent-sticky",
      role: "agent",
      blocks: [{ kind: "reasoning", text: "Проверяю контекст", duration: "2s" }],
    };

    renderMessage(message);

    expect(screen.getByRole("button", { name: /размышление/i })).toHaveStyle({ position: "sticky", top: "0px" });
  });

  it("archives a completed plan into agent details after a short delay", () => {
    vi.useFakeTimers();
    const message: ChatMessage = {
      id: "agent-plan",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Собрал план", duration: "1s" },
        { kind: "plan", steps: [{ label: "Проверить sticky", state: "ok" }] },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Plan")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /размышление/i }));

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Проверить sticky")).toBeInTheDocument();
  });

  it("moves resolved option prompts into agent details", () => {
    vi.useFakeTimers();
    const message: ChatMessage = {
      id: "agent-options",
      role: "agent",
      blocks: [
        {
          kind: "options",
          id: "question-1",
          prompt: "Как форматировать ответ?",
          options: [
            { id: "Summary", label: "Summary" },
            { id: "Detailed", label: "Detailed" },
          ],
          selected: ["Summary"],
        },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Как форматировать ответ?")).toBeInTheDocument();
    expect(screen.getByText("Выбрано: Summary")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Как форматировать ответ?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /размышление/i }));

    expect(screen.getByText("Как форматировать ответ?")).toBeInTheDocument();
    expect(screen.getByText("Выбрано: Summary")).toBeInTheDocument();
  });

  it("shows the agent model next to the agent label", () => {
    const message: ChatMessage = {
      id: "agent-3",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, undefined, { agent: "codex", model: "gpt-5.5", reasoning: "default", mode: "default" });

    expect(screen.getByText("Агент")).toBeInTheDocument();
    expect(screen.getByText("Codex · GPT-5.5")).toBeInTheDocument();
  });
});
