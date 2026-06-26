import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentBlockRenderer } from "../src/components/agent";
import { UserAvatar } from "../src/components/agent/blocks/parts";
import { Toast } from "../src/components/ui";
import { renderWithTheme } from "./util/render-with-theme";

describe("agent block i18n", () => {
  it("renders agent block chrome in Russian by default", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderWithTheme(
      <>
        <AgentBlockRenderer block={{ kind: "reasoning", text: "checking constraints", active: true }} />
        <AgentBlockRenderer block={{ kind: "reasoning", text: "done", duration: "2s" }} />
        <AgentBlockRenderer block={{ kind: "code", language: "ts", code: "export const ok = true;" }} />
        <AgentBlockRenderer block={{ kind: "command", command: "npm test", state: "pending" }} />
        <AgentBlockRenderer block={{ kind: "search", query: "vite", state: "ok", results: [{ title: "Vite", url: "https://vite.dev" }] }} />
        <AgentBlockRenderer
          block={{
            kind: "options",
            id: "question-1",
            prompt: "Выберите стратегию",
            options: [{ id: "a", label: "Вариант A" }],
          }}
          actions={{ onOptionSelection: () => undefined }}
        />
      </>,
    );

    expect(screen.getByText("Думает")).toBeInTheDocument();
    expect(screen.getByText("Размышление · думал 2s")).toBeInTheDocument();
    expect(screen.getByLabelText("Копировать код")).toBeInTheDocument();
    expect(screen.getByLabelText("ожидает")).toBeInTheDocument();
    expect(screen.getByText("Веб-поиск")).toBeInTheDocument();
    expect(screen.getByText("Результатов: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Вариант A"));
    fireEvent.click(screen.getByRole("button", { name: "Скопировать вопрос" }));
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(writeText).toHaveBeenCalledWith("Выберите стратегию\n1. Вариант A");
    expect(await screen.findByText("Вопрос скопирован")).toBeInTheDocument();
    expect(await screen.findByText("Выбрано: Вариант A")).toBeInTheDocument();
  });

  it("renders shared chrome labels in Russian by default", () => {
    renderWithTheme(
      <>
        <UserAvatar />
        <Toast message="Готово" onClose={() => undefined} />
      </>,
    );

    expect(screen.getByText("ВЫ")).toBeInTheDocument();
    expect(screen.getByLabelText("Закрыть уведомление")).toBeInTheDocument();
  });

  it("does not render an empty search disclosure for zero results", () => {
    const { container } = renderWithTheme(<AgentBlockRenderer block={{ kind: "search", query: "empty", state: "ok", results: [] }} />);

    expect(screen.getByText("Результатов: 0")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="KeyboardArrowDownIcon"]')).not.toBeInTheDocument();
  });
});
