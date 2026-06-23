import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "../src/components/agent";
import type { ChatMessage } from "../src/components/agent/core/types";
import type { PendingQueueItem } from "../src/client/api/workspace-page-api";
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

  it("renders goal and wakeup queue items with item controls", () => {
    const items: PendingQueueItem[] = [
      {
        id: "goal-1",
        conversationId: "c1",
        position: 0,
        kind: "goal",
        createdAtMs: 100,
        updatedAtMs: 100,
        state: "queued",
        description: "Keep improving",
        origin: "http://127.0.0.1:4280",
        dispatchCount: 0,
      },
      {
        id: "wakeup-1",
        conversationId: "c1",
        position: 1,
        kind: "wakeup",
        createdAtMs: 200,
        updatedAtMs: 200,
        state: "waiting_wakeup",
        wakeupId: "wakeup-1",
        prompt: "Continue later",
      },
    ];
    const onCancelItem = vi.fn();
    const onToggleItemPause = vi.fn();
    const onMoveItemAfter = vi.fn();
    renderWithTheme(
      <QueuedMessages
        messages={[]}
        items={items}
        paused={false}
        onCancel={vi.fn()}
        onCancelItem={onCancelItem}
        onCopy={vi.fn()}
        onSendNow={vi.fn()}
        onToggleItemPause={onToggleItemPause}
        onTogglePause={vi.fn()}
        onMoveItemAfter={onMoveItemAfter}
      />,
    );

    expect(screen.getByText("В очереди · 2")).toBeInTheDocument();
    expect(screen.getByText("Keep improving")).toBeInTheDocument();
    expect(screen.getByText("Continue later")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Поставить элемент на паузу" }));
    expect(onToggleItemPause).toHaveBeenCalledWith("goal-1", true);

    const cancelButtons = screen.getAllByRole("button", { name: "Отменить отложенное сообщение" });
    fireEvent.click(cancelButtons[1]);
    expect(onCancelItem).toHaveBeenCalledWith("wakeup-1");

    const rows = screen.getAllByText(/Keep improving|Continue later/).map((node) => node.closest("[draggable='true']"));
    expect(rows[0]).not.toBeNull();
    expect(rows[1]).not.toBeNull();
    const dragData: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: (type: string, value: string) => {
        dragData[type] = value;
      },
      getData: (type: string) => dragData[type] ?? "",
    };
    fireEvent.dragStart(rows[0] as Element, { dataTransfer });
    fireEvent.drop(rows[1] as Element, { dataTransfer });
    expect(onMoveItemAfter).toHaveBeenCalledWith("goal-1", "wakeup-1");
  });
});
