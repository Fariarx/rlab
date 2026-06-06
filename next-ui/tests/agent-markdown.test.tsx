import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentBlockRenderer } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("agent markdown rendering", () => {
  it("renders an assistant question list as structured chat content", () => {
    renderWithTheme(
      <AgentBlockRenderer
        block={{
          kind: "text",
          text: [
            "Чтобы я мог лучше понять вашу задачу, ответьте на следующие вопросы:",
            "",
            "1. **Какова основная идея или цель вашего проекта?** (веб-приложение, CLI-инструмент, библиотека)",
            "2. **Какой стек технологий вы планируете использовать?** (языки, фреймворки, базы данных)",
          ].join("\n"),
        }}
      />,
    );

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Какова основная идея или цель вашего проекта?").tagName).toBe("STRONG");
    expect(screen.getByText("Какой стек технологий вы планируете использовать?").tagName).toBe("STRONG");
  });

  it("renders fenced code in assistant text with the shared code block component", () => {
    renderWithTheme(
      <AgentBlockRenderer
        block={{
          kind: "text",
          text: ["Перед запуском проверь команду:", "", "```ts", "export const ok = true;", "```"].join("\n"),
        }}
      />,
    );

    expect(screen.getByLabelText("Копировать код")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByText("export const ok = true;")).toBeInTheDocument();
  });
});
