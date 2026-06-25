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
    <div ref={controller.containerRef} data-testid="scroller">
      <div ref={controller.contentRef} />
    </div>
  );
}

function sizeContainer(element: HTMLElement, { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  element.scrollTop = scrollTop;
}

describe("useConversationAutoScroll", () => {
  it("reveals the scroll-to-bottom affordance once the user scrolls up", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };
    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    expect(captured.current?.showScrollToBottom).toBe(false);

    const element = captured.current?.containerRef.current as HTMLElement;
    // Start at the bottom, then scroll up (scrollTop decreases) — only an upward
    // user scroll should release the pin.
    sizeContainer(element, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });
    expect(captured.current?.showScrollToBottom).toBe(false);

    element.scrollTop = 300;
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });
    expect(captured.current?.showScrollToBottom).toBe(true);
  });

  it("does not detach when content grows below the viewport without a user scroll", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };
    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    const element = captured.current?.containerRef.current as HTMLElement;
    // Pinned at the bottom.
    sizeContainer(element, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });

    // The agent appends a tall tool block: the content grows below and our snap
    // moves scrollTop down, but by the time the scroll event fires the content
    // has grown again so the bottom is "far" — this must NOT release the pin.
    Object.defineProperty(element, "scrollHeight", { value: 1600, configurable: true });
    element.scrollTop = 1000; // snapped down, yet not at the (new) bottom
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });

    expect(captured.current?.showScrollToBottom).toBe(false);
  });

  it("does not detach when composer shrink clamps the scroll position after submit", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };
    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    const element = captured.current?.containerRef.current as HTMLElement;
    sizeContainer(element, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });

    // Sending clears/shrinks the composer, which removes bottom spacer height
    // from the thread. Browsers clamp scrollTop down after the content shrinks;
    // that is layout, not a user scroll up, so the bottom pin must survive.
    Object.defineProperty(element, "scrollHeight", { value: 850, configurable: true });
    element.scrollTop = 550;
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });

    expect(captured.current?.showScrollToBottom).toBe(false);

    element.scrollTop = 300;
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });

    expect(captured.current?.showScrollToBottom).toBe(true);
  });

  it("snaps back to the bottom and hides the affordance", async () => {
    const captured: { current: ConversationAutoScrollController | null } = { current: null };
    render(<Harness capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    const element = captured.current?.containerRef.current as HTMLElement;
    sizeContainer(element, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });
    element.scrollTop = 300;
    await act(async () => {
      element.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(captured.current?.showScrollToBottom).toBe(true));

    const scrollTo = vi.fn();
    element.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
    await act(async () => {
      captured.current?.scrollToBottom();
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    await waitFor(() => expect(captured.current?.showScrollToBottom).toBe(false));
  });
});
