import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Conversation, ConversationList } from "../src/components/agent";
import { initialProjects } from "../src/components/workspace/sample-data";
import { renderWithTheme } from "./util/render-with-theme";

describe("Conversation a11y", () => {
  it("announces streaming updates politely", () => {
    renderWithTheme(<Conversation messages={[{ id: "u1", role: "user", text: "hello" }]} typing />);

    expect(screen.getByText("hello").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("keeps announcing a streaming agent message after the typing row is replaced", () => {
    renderWithTheme(
      <Conversation
        messages={[
          { id: "u1", role: "user", text: "hello" },
          { id: "a1", role: "agent", blocks: [{ kind: "text", text: "partial answer", streaming: true }] },
        ]}
      />,
    );

    expect(screen.getByText("partial answer").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("does not announce static completed threads", () => {
    renderWithTheme(<Conversation messages={[{ id: "u1", role: "user", text: "hello" }]} />);

    expect(screen.getByText("hello").closest("[aria-live]")).toHaveAttribute("aria-live", "off");
  });

  it("supports keyboard collapse and expand for project groups", () => {
    renderWithTheme(
      <ConversationList
        projects={initialProjects}
        chats={[]}
        selectedId="c-flaky"
        onSelect={vi.fn()}
        actions={{ onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() }}
      />,
    );

    const projectHeader = screen.getByRole("button", { name: /auth-service/i });
    expect(projectHeader).toHaveAttribute("aria-expanded", "true");

    projectHeader.focus();
    expect(projectHeader).toHaveFocus();

    fireEvent.keyDown(projectHeader, { key: " " });
    expect(projectHeader).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(projectHeader, { key: "Enter" });
    expect(projectHeader).toHaveAttribute("aria-expanded", "true");
  });
});
