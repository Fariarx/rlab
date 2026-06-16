import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ConversationAutoScrollController, useConversationAutoScroll } from "../src/components/agent/conversation/use-conversation-auto-scroll";

function Harness({ capture }: { readonly capture: (controller: ConversationAutoScrollController) => void }) {
  const controller = useConversationAutoScroll([{ id: "message-1" }]);
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return (
    <div ref={controller.containerRef}>
      <div data-testid="virtuoso-scroller" />
    </div>
  );
}

describe("useConversationAutoScroll", () => {
  it("releases follow output after a deliberate user scroll up", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };

    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    expect(captured.current?.followOutput()).toBe("auto");

    await act(async () => {
      captured.current?.containerRef.current?.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    });

    expect(captured.current?.followOutput()).toBe(false);
    await waitFor(() => expect(captured.current?.showScrollToBottom).toBe(true));
  });

  it("scrolls back to the latest item and hides the affordance", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };
    const scrollToIndex = vi.fn();

    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    await act(async () => {
      captured.current?.containerRef.current?.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    });
    await waitFor(() => expect(captured.current?.showScrollToBottom).toBe(true));

    if (captured.current) {
      captured.current.virtuosoRef.current = { scrollToIndex } as never;
    }
    await act(async () => {
      captured.current?.scrollToBottom();
    });

    expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "smooth" });
    await waitFor(() => expect(captured.current?.showScrollToBottom).toBe(false));
  });
});
