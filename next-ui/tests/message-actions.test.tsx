import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentBlockRenderer, ApprovalRequest, Conversation, messageToPlainText, type ChatMessage } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";

const messages: ChatMessage[] = [
  { id: "u1", role: "user", text: "Original prompt", time: "10:00" },
  { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Agent reply" }] },
];

describe("message actions", () => {
  it("clarifies persisted CLI permission denials in tool output and copied text", () => {
    const rawOutput = "The user rejected permission to use this specific tool call.";
    const displayOutput = "CLI permission gate denied this tool call before execution. No approval or rejection was recorded in the app.";
    const message: ChatMessage = {
      id: "a-permission",
      role: "agent",
      blocks: [{ kind: "tool", name: "Command", state: "error", output: rawOutput }],
    };

    renderWithTheme(<AgentBlockRenderer block={message.blocks?.[0] ?? { kind: "text", text: "" }} />);

    // Tools are collapsed by default (even on error); expand to inspect output.
    fireEvent.click(screen.getByText("Command"));
    expect(screen.getByText(displayOutput)).toBeInTheDocument();
    expect(screen.queryByText(rawOutput)).not.toBeInTheDocument();
    expect(messageToPlainText(message)).toContain(displayOutput);
    expect(messageToPlainText(message)).not.toContain(rawOutput);
  });

  it("exposes copy and edit controls for user messages without duplicate resend", () => {
    const onCopy = vi.fn();
    const onRetry = vi.fn();
    const onEditAndResend = vi.fn();

    renderWithThemeAndVirtuoso(
      <Conversation
        messages={messages}
        actions={{
          onCopy,
          onRetry,
          onEditAndResend,
        }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Скопировать сообщение" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Изменить и отправить" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Изменить сообщение" }), { target: { value: "Edited prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить изменённое сообщение" }));

    expect(onCopy).toHaveBeenCalledWith(messages[0]);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onEditAndResend).toHaveBeenCalledWith(messages[0], "Edited prompt");
  });

  it("exposes copy and retry for agent messages", () => {
    const onRetry = vi.fn();
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[messages[1]]}
        actions={{
          onCopy: vi.fn(),
          onRetry,
          onEditAndResend: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Скопировать сообщение" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить сообщение" }));

    expect(onRetry).toHaveBeenCalledWith(messages[1]);
    expect(screen.queryByRole("button", { name: "Изменить и отправить" })).not.toBeInTheDocument();
  });

  it("sends approval decisions from approval blocks", () => {
    const onApprovalDecision = vi.fn();
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          {
            id: "a-approval",
            role: "agent",
            blocks: [{ kind: "approval", id: "approval-1", title: "Approve Bash command?", detail: "npm test" }],
          },
        ]}
        actions={{ onApprovalDecision }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Одобрить" }));

    expect(onApprovalDecision).toHaveBeenCalledWith("approval-1", "approved");
  });

  it("sends option selections from AskUserQuestion option blocks", () => {
    const onOptionSelection = vi.fn();
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          {
            id: "a-options",
            role: "agent",
            blocks: [
              {
                kind: "options",
                id: "toolu_question:q0",
                prompt: "How should I format the output?",
                options: [
                  { id: "Summary", label: "Summary", description: "Brief overview" },
                  { id: "Detailed", label: "Detailed", description: "Full explanation" },
                ],
              },
            ],
          },
        ]}
        actions={{ onOptionSelection }}
      />,
    );

    fireEvent.click(screen.getByText("Summary"));
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(onOptionSelection).toHaveBeenCalledWith("toolu_question:q0", ["Summary"]);
  });

  it("sends a free-text answer from AskUserQuestion option blocks", () => {
    const onOptionSelection = vi.fn();
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          {
            id: "a-options",
            role: "agent",
            blocks: [
              {
                kind: "options",
                id: "toolu_question:q0",
                prompt: "How should I format the output?",
                multi: true,
                options: [
                  { id: "Summary", label: "Summary", description: "Brief overview" },
                  { id: "Detailed", label: "Detailed", description: "Full explanation" },
                ],
              },
            ],
          },
        ]}
        actions={{ onOptionSelection }}
      />,
    );

    expect(screen.getByText("Несколько вариантов")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Или скажите что не так..."), { target: { value: "Use a terse changelog format" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить текстом" }));

    expect(onOptionSelection).toHaveBeenCalledWith("toolu_question:q0", ["Use a terse changelog format"]);
  });

  it("does not locally confirm option selections without a persistence handler", () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          {
            id: "a-options",
            role: "agent",
            blocks: [
              {
                kind: "options",
                id: "toolu_question:q0",
                prompt: "How should I format the output?",
                options: [
                  { id: "Summary", label: "Summary", description: "Brief overview" },
                  { id: "Detailed", label: "Detailed", description: "Full explanation" },
                ],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Summary"));

    expect(screen.getByRole("button", { name: "Подтвердить" })).toBeDisabled();
    expect(screen.queryByText("Выбрано: Summary")).not.toBeInTheDocument();
    expect(screen.getByText("Ошибка выбора: У этого вопроса нет серверного обработчика сохранения.")).toBeInTheDocument();
  });

  it("keeps an approval pending when the decision handler fails", async () => {
    const onApprovalDecision = vi.fn().mockRejectedValue(new Error("permission bridge is unavailable"));

    renderWithTheme(
      <ApprovalRequest
        block={{ kind: "approval", id: "approval-1", title: "Approve Bash command?", detail: "npm test" }}
        onDecision={onApprovalDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Одобрить" }));

    expect(await screen.findByText("Ошибка подтверждения: permission bridge is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Одобрить" })).toBeInTheDocument();
    expect(screen.queryByText("Одобрено")).not.toBeInTheDocument();
  });
});
