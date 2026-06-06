import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Conversation, type ChatMessage } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("Conversation auto-scroll", () => {
  it("keeps streaming agent content visible as it updates", () => {
    const initialMessages: ChatMessage[] = [
      { id: "u1", role: "user", text: "Run this", time: "10:00" },
      { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Hel", streaming: true }] },
    ];

    const { rerender } = renderWithTheme(<Conversation messages={initialMessages} />);
    expect(screen.getByText("Hel")).toBeInTheDocument();

    rerender(
      <Conversation
        messages={[
          initialMessages[0],
          { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Hello", streaming: true }] },
        ]}
      />,
    );

    // The streaming text stays rendered (and the thread sticks to the bottom)
    // rather than being scrolled out of the viewport by an external scroll hack.
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("marks the thread as a live region while content streams", () => {
    renderWithTheme(
      <Conversation
        messages={[
          { id: "u1", role: "user", text: "Run this", time: "10:00" },
          { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Working", streaming: true }] },
        ]}
      />,
    );

    expect(screen.getByTestId("conversation-virtual-list")).toHaveAttribute("aria-live", "polite");
  });

  it("renders long threads in a native scroll container so streaming content stays visible", () => {
    renderWithTheme(
      <Conversation
        messages={Array.from({ length: 50 }, (_, index) => ({
          id: `m-${index}`,
          role: "user" as const,
          text: `Message ${index}`,
        }))}
      />,
    );

    const thread = screen.getByTestId("conversation-virtual-list");
    expect(thread).toBeInTheDocument();
    // The thread uses native overflow scrolling (not windowed virtualization) so
    // streaming agent output is never unmounted out of the viewport mid-update.
    expect(thread).toHaveAttribute("data-virtualized", "false");
    expect(screen.queryByTestId("virtuoso-scroller")).not.toBeInTheDocument();
  });
});
