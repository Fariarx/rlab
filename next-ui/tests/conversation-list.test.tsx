import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationList, type ConversationSummary } from "../src/components/agent";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";

const base: ConversationSummary = {
  id: "c1",
  title: "Alpha",
  snippet: "snippet",
  time: "now",
  status: "idle",
  agent: "claude-code",
};

function noopActions() {
  return { onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() };
}

function render(chats: readonly ConversationSummary[], actions = noopActions()) {
  renderWithThemeAndVirtuoso(<ConversationList projects={[]} chats={chats} selectedId={chats[0]?.id ?? null} onSelect={vi.fn()} actions={actions} />);
  return actions;
}

describe("ConversationList pinning", () => {
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

  it("does not render a conversation-count badge on group headers", () => {
    render([
      { ...base, id: "a", title: "Alpha" },
      { ...base, id: "b", title: "Beta" },
    ]);

    // The header is just the label (no trailing "2" count).
    expect(screen.getByRole("button", { name: "Чаты" })).toBeInTheDocument();
  });
});
