import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Conversation, type ChatMessage } from "../src/components/agent";
import { renderWithThemeAndVirtuoso, withVirtuosoMock } from "./util/render-with-virtuoso";

describe("Conversation auto-scroll", () => {
  it("keeps streaming agent content visible as it updates", () => {
    const initialMessages: ChatMessage[] = [
      { id: "u1", role: "user", text: "Run this", time: "10:00" },
      { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Hel", streaming: true }] },
    ];

    const { rerender } = renderWithThemeAndVirtuoso(<Conversation messages={initialMessages} />);
    expect(screen.getByText("Hel")).toBeInTheDocument();

    rerender(
      withVirtuosoMock(
        <Conversation
          messages={[
            initialMessages[0],
            { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Hello", streaming: true }] },
          ]}
        />,
      ),
    );

    // The streaming text stays rendered (and the thread sticks to the bottom)
    // rather than being scrolled out of the viewport by an external scroll hack.
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("marks the thread as a live region while content streams", () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={[
          { id: "u1", role: "user", text: "Run this", time: "10:00" },
          { id: "a1", role: "agent", time: "10:01", blocks: [{ kind: "text", text: "Working", streaming: true }] },
        ]}
      />,
    );

    expect(screen.getByTestId("conversation-virtual-list")).toHaveAttribute("aria-live", "polite");
  });

  it("windows very long threads to the most recent messages with a reveal control", () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={Array.from({ length: 200 }, (_, index) => ({
          id: `m-${index}`,
          role: "user" as const,
          text: `Message ${index}`,
        }))}
      />,
    );

    const thread = screen.getByTestId("conversation-virtual-list");
    expect(thread).toHaveAttribute("data-windowed", "true");
    // The newest message is rendered; an old one (outside the window) is not.
    expect(screen.getByText("Message 199")).toBeInTheDocument();
    expect(screen.queryByText("Message 0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Показать ещё/ })).toBeInTheDocument();
  });

  it("reveals earlier messages when the window is expanded", () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={Array.from({ length: 200 }, (_, index) => ({
          id: `m-${index}`,
          role: "user" as const,
          text: `Message ${index}`,
        }))}
      />,
    );

    expect(screen.queryByText("Message 100")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Показать ещё/ }));
    expect(screen.getByText("Message 100")).toBeInTheDocument();
  });

  it("shows a scroll-to-bottom button after the user scrolls away from the bottom", async () => {
    renderWithThemeAndVirtuoso(
      <Conversation
        messages={Array.from({ length: 20 }, (_, index) => ({
          id: `m-${index}`,
          role: "user" as const,
          text: `Message ${index}`,
        }))}
      />,
    );

    expect(screen.queryByRole("button", { name: "К последнему сообщению" })).not.toBeInTheDocument();

    const thread = screen.getByTestId("conversation-virtual-list");
    Object.defineProperty(thread, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(thread, "clientHeight", { value: 400, configurable: true });
    thread.scrollTop = 300; // scrolled up, far from the bottom
    fireEvent.scroll(thread);

    await waitFor(() => expect(screen.getByRole("button", { name: "К последнему сообщению" })).toBeInTheDocument());
  });
});
