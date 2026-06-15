import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "../src/components/agent";
import type { ChatMessage } from "../src/components/agent/core/types";
import { renderWithTheme } from "./util/render-with-theme";

const messages: ChatMessage[] = [
  { id: "q1", role: "user", text: "First queued turn" },
  { id: "q2", role: "user", text: "Second queued turn" },
];

describe("QueuedMessages", () => {
  it("renders nothing when the queue is empty", () => {
    renderWithTheme(<QueuedMessages messages={[]} onCancel={vi.fn()} onSendNow={vi.fn()} />);
    expect(screen.queryByTestId("queued-messages")).not.toBeInTheDocument();
  });

  it("lists queued turns with a count and supports cancel + send now", () => {
    const onCancel = vi.fn();
    const onSendNow = vi.fn();
    renderWithTheme(<QueuedMessages messages={messages} onCancel={onCancel} onSendNow={onSendNow} />);

    expect(screen.getByText("В очереди · 2")).toBeInTheDocument();
    expect(screen.getByText("First queued turn")).toBeInTheDocument();
    expect(screen.getByText("Second queued turn")).toBeInTheDocument();

    const cancelButtons = screen.getAllByRole("button", { name: "Отменить отложенное сообщение" });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledWith("q1");

    fireEvent.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    expect(onSendNow).toHaveBeenCalledTimes(1);
  });
});
