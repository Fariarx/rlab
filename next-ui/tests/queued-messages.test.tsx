import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "../src/components/agent";
import type { ChatMessage } from "../src/components/agent/core/types";
import { renderWithTheme } from "./util/render-with-theme";

const messages: ChatMessage[] = [
  { id: "q1", role: "user", text: "First queued turn" },
  { id: "q2", role: "user", text: "Second queued turn" },
];

function queuedMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({ id: `q${index + 1}`, role: "user", text: `Queued turn ${index + 1}` }));
}

describe("QueuedMessages", () => {
  it("renders nothing when the queue is empty", () => {
    renderWithTheme(<QueuedMessages messages={[]} paused={false} onCancel={vi.fn()} onCopy={vi.fn()} onSendNow={vi.fn()} onTogglePause={vi.fn()} />);
    expect(screen.queryByTestId("queued-messages")).not.toBeInTheDocument();
  });

  it("lists queued turns with a count and supports copy, cancel, send now, and pause", () => {
    const onCancel = vi.fn();
    const onCopy = vi.fn();
    const onSendNow = vi.fn();
    const onTogglePause = vi.fn();
    renderWithTheme(
      <QueuedMessages messages={messages} paused={false} onCancel={onCancel} onCopy={onCopy} onSendNow={onSendNow} onTogglePause={onTogglePause} />,
    );

    expect(screen.getByText("В очереди · 2")).toBeInTheDocument();
    expect(screen.getByText("First queued turn")).toBeInTheDocument();
    expect(screen.getByText("Second queued turn")).toBeInTheDocument();

    const copyButtons = screen.getAllByRole("button", { name: "Скопировать отложенное сообщение" });
    fireEvent.click(copyButtons[0]);
    expect(onCopy).toHaveBeenCalledWith(messages[0]);

    const cancelButtons = screen.getAllByRole("button", { name: "Отменить отложенное сообщение" });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledWith("q1");

    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(onTogglePause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    expect(onSendNow).toHaveBeenCalledTimes(1);
  });

  it("shows the resume control and paused title when paused", () => {
    renderWithTheme(
      <QueuedMessages messages={messages} paused onCancel={vi.fn()} onCopy={vi.fn()} onSendNow={vi.fn()} onTogglePause={vi.fn()} />,
    );

    expect(screen.getByText("В очереди · 2 · пауза")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Возобновить" })).toBeInTheDocument();
  });

  it("scrolls the queued turn list only after five messages", () => {
    const { rerender } = renderWithTheme(
      <QueuedMessages messages={queuedMessages(5)} paused={false} onCancel={vi.fn()} onCopy={vi.fn()} onSendNow={vi.fn()} onTogglePause={vi.fn()} />,
    );

    expect(screen.getByTestId("queued-messages-list")).not.toHaveAttribute("data-scrollable");

    rerender(
      <QueuedMessages messages={queuedMessages(6)} paused={false} onCancel={vi.fn()} onCopy={vi.fn()} onSendNow={vi.fn()} onTogglePause={vi.fn()} />,
    );

    expect(screen.getByTestId("queued-messages-list")).toHaveAttribute("data-scrollable", "true");
  });
});
