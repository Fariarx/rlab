import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalRequest, Conversation, type ChatMessage } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

const messages: ChatMessage[] = [
  { id: "u1", role: "user", text: "Original prompt", time: "10:00" },
  { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Agent reply" }] },
];

describe("message actions", () => {
  it("exposes copy, retry, and edit controls for user messages", () => {
    const onCopy = vi.fn();
    const onRetry = vi.fn();
    const onEditAndResend = vi.fn();

    renderWithTheme(
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
    fireEvent.click(screen.getByRole("button", { name: "Повторить сообщение" }));
    fireEvent.click(screen.getByRole("button", { name: "Изменить и отправить" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Изменить сообщение" }), { target: { value: "Edited prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить изменённое сообщение" }));

    expect(onCopy).toHaveBeenCalledWith(messages[0]);
    expect(onRetry).toHaveBeenCalledWith(messages[0]);
    expect(onEditAndResend).toHaveBeenCalledWith(messages[0], "Edited prompt");
  });

  it("only exposes copy for agent messages", () => {
    renderWithTheme(
      <Conversation
        messages={[messages[1]]}
        actions={{
          onCopy: vi.fn(),
          onRetry: vi.fn(),
          onEditAndResend: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Скопировать сообщение" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Повторить сообщение" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Изменить и отправить" })).not.toBeInTheDocument();
  });

  it("sends approval decisions from approval blocks", () => {
    const onApprovalDecision = vi.fn();
    renderWithTheme(
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
    renderWithTheme(
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
