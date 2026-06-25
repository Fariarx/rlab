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

  it("repairs malformed plain-text fences without swallowing following prose", () => {
    renderWithTheme(
      <AgentBlockRenderer
        block={{
          kind: "text",
          text: [
            "`scattermoe` даёт эффективный dispatch/compute для MoE-экспертов.",
            "",
            "```textfor expert in experts:",
            " выбрать токены этого эксперта прогнать FFN вернуть результат обратно```",
            "",
            "Это много Python-циклов, мелких matmul, scatter/index_add и плохая загрузка GPU.",
            "",
            "```texttop_idx -> sort/group by expertсобрать токены по экспертамсделать grouped expert GEMMвзвесить gatesscatter/combine обратно```",
            "",
            "В текущем коде он даёт три главные вещи:",
          ].join("\n"),
        }}
      />,
    );

    expect(screen.queryByText("textfor")).not.toBeInTheDocument();
    expect(screen.queryByText("texttop_idx")).not.toBeInTheDocument();
    expect(screen.getAllByText("text")).toHaveLength(2);
    const preBlocks = Array.from(document.querySelectorAll("pre"));
    expect(preBlocks).toHaveLength(2);
    expect(preBlocks[0]).toHaveTextContent("for expert in experts:");
    expect(preBlocks[1]).toHaveTextContent("top_idx -> sort/group by expertсобрать токены по экспертамсделать grouped expert GEMMвзвесить gatesscatter/combine обратно");
    expect(screen.getByText("Это много Python-циклов, мелких matmul, scatter/index_add и плохая загрузка GPU.").closest("pre")).toBeNull();
    expect(screen.getByText("В текущем коде он даёт три главные вещи:").closest("pre")).toBeNull();
  });
});
