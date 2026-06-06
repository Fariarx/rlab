import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ConversationList, type ChatMessage, type ConversationSummary } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

const baseConversation: ConversationSummary = {
  id: "search-chat",
  title: "Release work",
  snippet: "No direct match",
  time: "now",
  status: "done",
  agent: "claude-code",
};

function renderList(chats: readonly ConversationSummary[], threads: Record<string, ChatMessage[]> = {}) {
  renderWithTheme(
    <ConversationList
      mode="chats"
      projects={[]}
      selectedId={chats[0]?.id ?? null}
      onSelect={vi.fn()}
      actions={{ onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }}
      chats={chats}
      threads={threads}
    />,
  );
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
      <ConversationList
        mode="chats"
        projects={[]}
        selectedId={selectedId}
        onSelect={setSelectedId}
        actions={{ onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }}
        chats={chats}
      />
    </div>
  );
}

describe("conversation search", () => {
  it("renders chat rows through a virtualized list", () => {
    renderList(Array.from({ length: 40 }, (_, index) => ({ ...baseConversation, id: `chat-${index}`, title: `Chat ${index}` })));

    expect(screen.getByTestId("conversation-list-virtual-list")).toHaveAttribute("data-virtualized", "true");
  });

  it("matches chat snippets", () => {
    renderList([{ ...baseConversation, snippet: "Contains deploy needle" }]);

    fireEvent.change(screen.getByPlaceholderText("Поиск чатов..."), { target: { value: "needle" } });

    expect(screen.getByText("Release work")).toBeInTheDocument();
  });

  it("matches persisted thread message content", () => {
    renderList([baseConversation], {
      "search-chat": [{ id: "m1", role: "user", text: "Needle appears only in the saved thread" }],
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск чатов..."), { target: { value: "needle" } });

    expect(screen.getByText("Release work")).toBeInTheDocument();
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
