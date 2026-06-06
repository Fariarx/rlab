import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationList } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("usage cost", () => {
  it("shows conversation cost and token usage in the sidebar row", () => {
    renderWithTheme(
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

    expect(screen.getByText("$0.0173")).toBeInTheDocument();
    expect(screen.getByText("9.7k tok")).toBeInTheDocument();
  });
});
