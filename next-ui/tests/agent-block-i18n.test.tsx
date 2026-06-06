import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentBlockRenderer } from "../src/components/agent";
import { UserAvatar } from "../src/components/agent/parts";
import { Toast } from "../src/components/ui";
import { renderWithTheme } from "./util/render-with-theme";

describe("agent block i18n", () => {
  it("renders agent block chrome in Russian by default", () => {
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
            prompt: "Выберите стратегию",
            options: [{ id: "a", label: "Вариант A" }],
          }}
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
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(screen.getByText("Выбрано: Вариант A")).toBeInTheDocument();
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
});
