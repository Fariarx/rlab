import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationList, type ChatMessage, type ConversationSummary } from "../src/components/agent";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";

const base: ConversationSummary = {
  id: "c1",
  title: "Alpha",
  snippet: "snippet",
  time: "now",
  status: "idle",
  agent: "claude-code",
};

afterEach(() => {
  vi.useRealTimers();
});

function noopActions() {
  return { onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() };
}

function render(chats: readonly ConversationSummary[], actions = noopActions(), wakeupConversationIds: ReadonlySet<string> = new Set(), threads: Readonly<Record<string, readonly ChatMessage[]>> = {}) {
  renderWithThemeAndVirtuoso(
    <ConversationList projects={[]} chats={chats} threads={threads} selectedId={chats[0]?.id ?? null} onSelect={vi.fn()} actions={actions} wakeupConversationIds={wakeupConversationIds} />,
  );
  return actions;
}

describe("ConversationList pinning", () => {
  it("hides archived conversations from the normal sidebar list", () => {
    render([
      { ...base, id: "archived", title: "Archived chat", archived: true },
      { ...base, id: "plain", title: "Plain chat" },
    ]);

    expect(screen.queryByRole("option", { name: "Archived chat" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Plain chat" })).toBeInTheDocument();
  });

  it("lifts pinned conversations into a Pinned group and out of their original list", () => {
    render([
      { ...base, id: "pinned", title: "Pinned chat", pinned: true },
      { ...base, id: "plain", title: "Plain chat" },
    ]);

    expect(screen.getByRole("button", { name: /Закреплённые/ })).toBeInTheDocument();
    // Pinned conversation shows exactly once (only in the Pinned group).
    expect(screen.getAllByRole("option", { name: "Pinned chat" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Чаты/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Plain chat" })).toBeInTheDocument();
  });

  it("does not render the Pinned group when nothing is pinned", () => {
    render([{ ...base, id: "plain", title: "Plain chat" }]);
    expect(screen.queryByRole("button", { name: /Закреплённые/ })).not.toBeInTheDocument();
  });

  it("offers Pin in the row menu and calls onTogglePin", () => {
    const actions = render([{ ...base, id: "plain", title: "Plain chat" }]);

    fireEvent.click(screen.getByRole("button", { name: "Действия с диалогом" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Закрепить" }));

    expect(actions.onTogglePin).toHaveBeenCalledWith("plain");
  });

  it("offers Unpin for an already pinned conversation", () => {
    render([{ ...base, id: "pinned", title: "Pinned chat", pinned: true }]);

    fireEvent.click(screen.getByRole("button", { name: "Действия с диалогом" }));
    expect(screen.getByRole("menuitem", { name: "Открепить" })).toBeInTheDocument();
  });
});

describe("ConversationList rename", () => {
  it("commits a rename from the row menu on Enter", () => {
    const actions = render([{ ...base, id: "c1", title: "Old title" }]);

    fireEvent.click(screen.getByRole("button", { name: "Действия с диалогом" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions.onRename).toHaveBeenCalledWith("c1", "New title");
  });
});

describe("ConversationList status dots", () => {
  it("hides the resting (idle/done) status dots but keeps actionable ones", () => {
    render([
      { ...base, id: "done", title: "Done chat", status: "done" },
      { ...base, id: "run", title: "Running chat", status: "running" },
    ]);

    expect(screen.queryByRole("img", { name: "Готово" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "В работе" })).toBeInTheDocument();
  });

  it("shows a green status dot for a finished, unviewed conversation and drops it once read", () => {
    const finished = { ...base, id: "fin", title: "Finished chat", status: "done" as const, unread: true };
    const actions = noopActions();
    const rendered = renderWithThemeAndVirtuoso(
      <ConversationList projects={[]} chats={[finished]} selectedId="" onSelect={vi.fn()} actions={actions} wakeupConversationIds={new Set()} />,
    );
    expect(screen.getByRole("img", { name: "Готово · не просмотрено" })).toBeInTheDocument();

    rendered.rerender(
      <ConversationList projects={[]} chats={[{ ...finished, unread: false }]} selectedId="" onSelect={vi.fn()} actions={actions} wakeupConversationIds={new Set()} />,
    );
    expect(screen.queryByRole("img", { name: "Готово · не просмотрено" })).not.toBeInTheDocument();
  });

  it("shows a warning status for idle conversations with an active wakeup", () => {
    render([{ ...base, id: "wakeup", title: "Wakeup chat", status: "idle" }], noopActions(), new Set(["wakeup"]));

    expect(screen.getByRole("img", { name: "Wakeup запланирован" })).toBeInTheDocument();
  });

  it("lets an active wakeup override an existing error status visually", () => {
    render([{ ...base, id: "wakeup", title: "Wakeup chat", status: "error" }], noopActions(), new Set(["wakeup"]));

    expect(screen.getByRole("img", { name: "Wakeup запланирован" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Ошибка" })).not.toBeInTheDocument();
  });

  it("updates already-rendered rows when wakeups arrive after the list mounts", () => {
    const chat = { ...base, id: "wakeup", title: "Wakeup chat", status: "error" as const };
    const actions = noopActions();
    const rendered = renderWithThemeAndVirtuoso(<ConversationList projects={[]} chats={[chat]} selectedId="wakeup" onSelect={vi.fn()} actions={actions} wakeupConversationIds={new Set()} />);

    expect(screen.getByRole("img", { name: "Ошибка" })).toBeInTheDocument();

    rendered.rerender(<ConversationList projects={[]} chats={[chat]} selectedId="wakeup" onSelect={vi.fn()} actions={actions} wakeupConversationIds={new Set(["wakeup"])} />);

    expect(screen.getByRole("img", { name: "Wakeup запланирован" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Ошибка" })).not.toBeInTheDocument();
  });
});

describe("ConversationList activity ordering", () => {
  it("floats active chats within their group with green status first", () => {
    render([
      { ...base, id: "idle", title: "Idle chat", status: "idle" },
      { ...base, id: "waiting", title: "Waiting chat", status: "waiting" },
      { ...base, id: "done", title: "Done chat", status: "done" },
      { ...base, id: "running", title: "Running chat", status: "running" },
    ]);

    expect(screen.getAllByRole("option").map((row) => row.getAttribute("aria-label"))).toEqual([
      "Done chat",
      "Running chat",
      "Waiting chat",
      "Idle chat",
    ]);
  });

  it("sorts active conversations inside each project without moving them between groups", () => {
    renderWithThemeAndVirtuoso(
      <ConversationList
        projects={[
          {
            id: "p1",
            name: "Project one",
            path: "/project-one",
            conversations: [
              { ...base, id: "p1-idle", title: "P1 idle", status: "idle" },
              { ...base, id: "p1-running", title: "P1 running", status: "running" },
            ],
          },
          {
            id: "p2",
            name: "Project two",
            path: "/project-two",
            conversations: [
              { ...base, id: "p2-wakeup", title: "P2 wakeup", status: "idle" },
              { ...base, id: "p2-done", title: "P2 done", status: "done" },
            ],
          },
        ]}
        chats={[]}
        selectedId={null}
        onSelect={vi.fn()}
        actions={noopActions()}
        wakeupConversationIds={new Set(["p2-wakeup"])}
      />,
    );

    expect(screen.getAllByRole("option").map((row) => row.getAttribute("aria-label"))).toEqual([
      "P1 running",
      "P1 idle",
      "P2 done",
      "P2 wakeup",
    ]);
  });
});

describe("ConversationList time labels", () => {
  it("renders persisted AM/PM labels as 24-hour time", () => {
    render([{ ...base, id: "pm", title: "PM chat", time: "03:19 PM" }]);

    expect(screen.getByText("15:19")).toBeInTheDocument();
    expect(screen.queryByText("03:19 PM")).not.toBeInTheDocument();
  });

  it("renders today as time, past days as numeric date, and past years with year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 17, 11, 0));

    render([
      { ...base, id: "today", title: "Today", time: "legacy", updatedAtMs: new Date(2026, 5, 17, 9, 7).getTime() },
      { ...base, id: "yesterday", title: "Yesterday", time: "legacy", updatedAtMs: new Date(2026, 5, 16, 23, 59).getTime() },
      { ...base, id: "last-year", title: "Last year", time: "legacy", updatedAtMs: new Date(2025, 11, 31, 23, 59).getTime() },
    ]);

    expect(screen.getByText("09:07")).toBeInTheDocument();
    expect(screen.getByText("16.06")).toBeInTheDocument();
    expect(screen.getByText("31.12.2025")).toBeInTheDocument();
  });
});

describe("ConversationList subtitles", () => {
  it("renders the latest user/model text instead of a persisted dialog status snippet", () => {
    render(
      [{ ...base, id: "status-snippet", title: "Status snippet", snippet: "Запуск завершился с ошибкой", status: "error" }],
      noopActions(),
      new Set(),
      {
        "status-snippet": [
          { id: "u1", role: "user", text: "Проверь SDK интеграцию" },
          { id: "a1", role: "agent", blocks: [{ kind: "status", level: "error", text: "Запуск завершился с ошибкой" }] },
        ],
      },
    );

    expect(screen.getByText("Проверь SDK интеграцию")).toBeInTheDocument();
    expect(screen.queryByText("Запуск завершился с ошибкой")).not.toBeInTheDocument();
  });
});

describe("ConversationList collapsed group indicators", () => {
  it("shows the unread indicator on the header only while the group is collapsed", () => {
    render([{ ...base, id: "c1", title: "Alpha", unread: true }]);

    const header = screen.getByRole("button", { name: /Чаты/ });
    // Expanded by default — the row carries the unread state, not the header.
    expect(screen.queryByRole("img", { name: "Непрочитанные" })).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByRole("img", { name: "Непрочитанные" })).toBeInTheDocument();
  });

  it("prefers the running status over the unread marker when collapsed", () => {
    render([{ ...base, id: "c1", title: "Alpha", unread: true, status: "running" }]);

    fireEvent.click(screen.getByRole("button", { name: /Чаты/ }));

    // Status wins; the unread dot is not shown alongside it.
    expect(screen.getByRole("img", { name: "в работе: 1" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Непрочитанные" })).not.toBeInTheDocument();
  });

  it("shows the wakeup status when a collapsed group has scheduled work", () => {
    render([{ ...base, id: "wakeup", title: "Wakeup chat" }], noopActions(), new Set(["wakeup"]));

    fireEvent.click(screen.getByRole("button", { name: /Чаты/ }));

    expect(screen.getByRole("img", { name: "Wakeup запланирован" })).toBeInTheDocument();
  });

  it("does not render a conversation-count badge on group headers", () => {
    render([
      { ...base, id: "a", title: "Alpha" },
      { ...base, id: "b", title: "Beta" },
    ]);

    // The header is just the label (no trailing "2" count).
    expect(screen.getByRole("button", { name: "Чаты" })).toBeInTheDocument();
  });
});
