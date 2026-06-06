import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ConversationList, ConversationSearch, type ChatMessage, type ConversationSummary } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

const baseConversation: ConversationSummary = {
  id: "search-chat",
  title: "Release work",
  snippet: "No direct match",
  time: "now",
  status: "done",
  agent: "claude-code",
};

function renderSearch(chats: readonly ConversationSummary[], threads: Record<string, ChatMessage[]> = {}) {
  renderWithTheme(<ConversationSearch open projects={[]} chats={chats} threads={threads} onClose={vi.fn()} onSelect={vi.fn()} />);
}

function KeyboardProbe() {
  const chats: readonly ConversationSummary[] = [
    { ...baseConversation, id: "chat-1", title: "First chat" },
    { ...baseConversation, id: "chat-2", title: "Second chat" },
    { ...baseConversation, id: "chat-3", title: "Third chat" },
  ];
  const [selectedId, setSelectedId] = useState("chat-1");

  return (
    <div>
      <div data-testid="selected-id">{selectedId}</div>
      <ConversationList projects={[]} selectedId={selectedId} onSelect={setSelectedId} actions={{ onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }} chats={chats} />
    </div>
  );
}

describe("conversation list", () => {
  it("renders chat rows without virtualization", () => {
    renderWithTheme(
      <ConversationList
        projects={[]}
        selectedId="chat-0"
        onSelect={vi.fn()}
        actions={{ onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }}
        chats={Array.from({ length: 40 }, (_, index) => ({ ...baseConversation, id: `chat-${index}`, title: `Chat ${index}` }))}
      />,
    );

    expect(screen.getByTestId("conversation-list-virtual-list")).toHaveAttribute("data-virtualized", "false");
  });

  it("moves conversation selection with arrow keys and keeps focus on the active row", async () => {
    renderWithTheme(<KeyboardProbe />);

    const first = screen.getByRole("option", { name: "First chat" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(first, { key: "ArrowDown" });

    await waitFor(() => {
      const second = screen.getByRole("option", { name: "Second chat" });
      expect(screen.getByTestId("selected-id")).toHaveTextContent("chat-2");
      expect(second).toHaveAttribute("tabindex", "0");
      expect(second).toHaveFocus();
    });
  });

  it("selects a conversation row with Enter", () => {
    renderWithTheme(<KeyboardProbe />);

    fireEvent.keyDown(screen.getByRole("option", { name: "Second chat" }), { key: "Enter" });

    expect(screen.getByTestId("selected-id")).toHaveTextContent("chat-2");
  });
});

describe("conversation search popup", () => {
  it("matches chat snippets", () => {
    renderSearch([{ ...baseConversation, snippet: "Contains deploy needle" }]);

    fireEvent.change(screen.getByPlaceholderText("Поиск по названию или сообщению..."), { target: { value: "needle" } });

    expect(screen.getByRole("button", { name: "Release work" })).toBeInTheDocument();
  });

  it("matches persisted thread message content", () => {
    renderSearch([baseConversation], {
      "search-chat": [{ id: "m1", role: "user", text: "Needle appears only in the saved thread" }],
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск по названию или сообщению..."), { target: { value: "needle" } });

    expect(screen.getByRole("button", { name: "Release work" })).toBeInTheDocument();
  });

  it("reports when nothing matches the query", () => {
    renderSearch([{ ...baseConversation, snippet: "No direct match" }]);

    fireEvent.change(screen.getByPlaceholderText("Поиск по названию или сообщению..."), { target: { value: "zzz-nothing" } });

    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });

  it("states when there are no conversations at all", () => {
    renderSearch([]);

    expect(screen.getByText("Пока нет диалогов")).toBeInTheDocument();
  });

  it("focuses the search field when it opens", async () => {
    renderSearch([baseConversation]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Поиск по названию или сообщению...")).toHaveFocus();
    });
  });
});
