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
    const onEdit = vi.fn();
    const onSendNow = vi.fn();
    const onTogglePause = vi.fn();
    renderWithTheme(
      <QueuedMessages messages={messages} paused={false} onCancel={onCancel} onCopy={onCopy} onEdit={onEdit} onSendNow={onSendNow} onTogglePause={onTogglePause} />,
    );

    expect(screen.getByText("В очереди · 2")).toBeInTheDocument();
    expect(screen.getByText("First queued turn")).toBeInTheDocument();
    expect(screen.getByText("Second queued turn")).toBeInTheDocument();

    const editButtons = screen.getAllByRole("button", { name: "Редактировать отложенное сообщение" });
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "q1", kind: "message", message: messages[0] }));

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
        id: "goal-2",
        conversationId: "c1",
        position: 1,
        kind: "goal",
        createdAtMs: 150,
        updatedAtMs: 150,
        state: "queued",
        description: "Keep testing",
        origin: "http://127.0.0.1:4280",
        dispatchCount: 0,
      },
      {
        id: "goal-active",
        conversationId: "c1",
        position: 2,
        kind: "goal",
        createdAtMs: 175,
        updatedAtMs: 175,
        state: "dispatching",
        runId: "run-goal-active",
        description: "Active goal",
        origin: "http://127.0.0.1:4280",
        dispatchCount: 1,
      },
      {
        id: "wakeup-1",
        conversationId: "c1",
        position: 3,
        kind: "wakeup",
        createdAtMs: 200,
        updatedAtMs: 200,
        state: "waiting_wakeup",
        wakeupId: "wakeup-1",
        agent: "codex",
        prompt: "Continue later",
        trigger: { type: "time", fireAtMs: 1_800_000_000_000 },
      },
    ];
    const onCancelItem = vi.fn();
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
        onTogglePause={vi.fn()}
        onMoveItemAfter={onMoveItemAfter}
      />,
    );

    expect(screen.getByText("Ожидание Wakeup · 4")).toBeInTheDocument();
    expect(screen.getByTestId("queued-header-schedule-icon")).toBeInTheDocument();
    expect(screen.getByText("Keep improving")).toBeInTheDocument();
    expect(screen.getByText("Keep testing")).toBeInTheDocument();
    expect(screen.getByText("Active goal")).toBeInTheDocument();
    expect(screen.getByTestId("queued-item-wakeup-1")).toHaveTextContent("Агент: codex");
    expect(screen.getByTestId("queued-item-wakeup-1")).toHaveTextContent("Промпт: Continue later");
    expect(screen.getByText("В работе")).toBeInTheDocument();
    expect(screen.getByText("В работе").closest(".queued-actions")).not.toBeNull();
    expect(screen.getByTestId("queued-item-wakeup-1").compareDocumentPosition(screen.getByTestId("queued-item-goal-1"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId("queued-item-wakeup-1").compareDocumentPosition(screen.getByTestId("queued-item-goal-active"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.queryByRole("button", { name: "Поставить элемент на паузу" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Возобновить элемент" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить сейчас" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Отменить Wakeup" }));
    expect(onCancelItem).toHaveBeenCalledWith("wakeup-1");
    expect(screen.getAllByRole("button", { name: "Удалить цель" })).toHaveLength(3);

    fireEvent.click(screen.getByTestId("queued-item-wakeup-1"));
    expect(screen.getByTestId("queued-wakeup-popover-wakeup-1")).toBeInTheDocument();
    expect(screen.getByText("Continue later")).toBeInTheDocument();

    expect(screen.getAllByLabelText("Переместить элемент очереди")).toHaveLength(2);
    expect(screen.getByTestId("queued-item-wakeup-1").querySelector("[aria-label='Переместить элемент очереди']")).toBeNull();
    expect(screen.getByTestId("queued-item-goal-active").querySelector("[aria-label='Переместить элемент очереди']")).toBeNull();
    expect(onMoveItemAfter).not.toHaveBeenCalled();
  });

  it("does not send now when the only visible item is an active goal", () => {
    const onSendNow = vi.fn();
    renderWithTheme(
      <QueuedMessages
        messages={[]}
        items={[
          {
            id: "goal-active",
            conversationId: "c1",
            position: 0,
            kind: "goal",
            createdAtMs: 100,
            updatedAtMs: 100,
            state: "dispatching",
            runId: "run-goal-active",
            description: "Active goal",
            origin: "http://127.0.0.1:4280",
            dispatchCount: 1,
          },
        ]}
        paused={false}
        onCancel={vi.fn()}
        onCancelItem={vi.fn()}
        onCopy={vi.fn()}
        onSendNow={onSendNow}
        onTogglePause={vi.fn()}
      />,
    );

    expect(screen.getByText("Active goal")).toBeInTheDocument();
    expect(screen.getByText("В работе")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    expect(onSendNow).not.toHaveBeenCalled();
  });

  it("keeps send now available for queued goals", () => {
    const onSendNow = vi.fn();
    renderWithTheme(
      <QueuedMessages
        messages={[]}
        items={[
          {
            id: "goal-1",
            conversationId: "c1",
            position: 0,
            kind: "goal",
            createdAtMs: 100,
            updatedAtMs: 100,
            state: "queued",
            description: "Queued goal",
            origin: "http://127.0.0.1:4280",
            dispatchCount: 0,
          },
        ]}
        paused={false}
        onCancel={vi.fn()}
        onCancelItem={vi.fn()}
        onCopy={vi.fn()}
        onSendNow={onSendNow}
        onTogglePause={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    expect(onSendNow).toHaveBeenCalledTimes(1);
  });

  it("shows waiting goal cooldown instead of a silent active queue", () => {
    renderWithTheme(
      <QueuedMessages
        messages={[]}
        items={[
          {
            id: "goal-waiting",
            conversationId: "c1",
            position: 0,
            kind: "goal",
            createdAtMs: 100,
            updatedAtMs: 100,
            state: "queued",
            nextDispatchAtMs: Date.now() + 60_000,
            description: "Queued goal",
            origin: "http://127.0.0.1:4280",
            dispatchCount: 2,
          },
        ]}
        paused={false}
        onCancel={vi.fn()}
        onCancelItem={vi.fn()}
        onCopy={vi.fn()}
        onSendNow={vi.fn()}
        onTogglePause={vi.fn()}
      />,
    );

    expect(screen.getByText("Ожидание цели · 1")).toBeInTheDocument();
    expect(screen.getByText("Через 60с")).toBeInTheDocument();
    expect(screen.getByText("Через 60с").closest(".queued-actions")).not.toBeNull();
  });

  it("shows a paused goal status when the queue is globally paused", () => {
    renderWithTheme(
      <QueuedMessages
        messages={[]}
        items={[
          {
            id: "goal-paused",
            conversationId: "c1",
            position: 0,
            kind: "goal",
            createdAtMs: 100,
            updatedAtMs: 100,
            state: "queued",
            nextDispatchAtMs: Date.now() + 60_000,
            description: "Paused queued goal",
            origin: "http://127.0.0.1:4280",
            dispatchCount: 2,
          },
        ]}
        paused
        onCancel={vi.fn()}
        onCancelItem={vi.fn()}
        onCopy={vi.fn()}
        onSendNow={vi.fn()}
        onTogglePause={vi.fn()}
      />,
    );

    expect(screen.getByText("В очереди · 1 · пауза")).toBeInTheDocument();
    expect(screen.queryByText("Ожидание цели · 1")).not.toBeInTheDocument();
    expect(screen.getByText("Пауза")).toBeInTheDocument();
    expect(screen.queryByText("Через 60с")).not.toBeInTheDocument();
    expect(screen.getByText("Пауза").closest(".queued-actions")).not.toBeNull();
  });
});
