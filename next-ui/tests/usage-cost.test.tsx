import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Conversation, ConversationList } from "../src/components/agent";
import { renderWithThemeAndVirtuoso } from "./util/render-with-virtuoso";

describe("usage cost", () => {
  it("does not show conversation cost and token usage in the sidebar row", () => {
    renderWithThemeAndVirtuoso(
      <ConversationList
        projects={[]}
        selectedId="cost-chat"
        onSelect={vi.fn()}
        actions={{ onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }}
        chats={[
          {
            id: "cost-chat",
            title: "Costed run",
            snippet: "Run completed",
            time: "now",
            status: "done",
            agent: "claude-code",
            costUsd: 0.0173,
            usage: { totalTokens: 9653 },
          },
        ]}
      />,
    );

    expect(screen.queryByText("$0.0173")).not.toBeInTheDocument();
    expect(screen.queryByText("9.7k")).not.toBeInTheDocument();
  });

  it("does not show agent message cost and token usage in the conversation", () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          {
            id: "a-cost",
            role: "agent",
            time: "10:01",
            blocks: [{ kind: "text", text: "Done" }],
            costUsd: 0.0042,
            usage: { totalTokens: 1200 },
          },
        ]}
      />,
    );

    expect(screen.queryByText("$0.0042")).not.toBeInTheDocument();
    expect(screen.queryByText("1.2k")).not.toBeInTheDocument();
  });
});
