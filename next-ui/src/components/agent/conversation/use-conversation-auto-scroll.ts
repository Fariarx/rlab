import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

export interface ConversationAutoScrollController {
  readonly virtuosoRef: RefObject<VirtuosoHandle | null>;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly setUserScrolling: (scrolling: boolean) => void;
  readonly handleAtBottomStateChange: (atBottom: boolean) => void;
  readonly followOutput: () => "auto" | false;
}

/**
 * Keeps the thread pinned to the newest message while leaving the user free to
 * scroll up and read history.
 *
 * This deliberately leans on Virtuoso's own stick-to-bottom machinery
 * (`followOutput` + `atBottomStateChange`) instead of fighting it. The previous
 * implementation ran a 100ms `setInterval` that re-issued `scrollToIndex` plus a
 * raw `scrollTop = scrollHeight` for up to six seconds per update, layered on a
 * `requestAnimationFrame` re-pin — three scroll commands racing each other on
 * every streamed token, which read as the jumpy/glitchy scrolling. Here:
 *
 *  - `followOutput` glues the viewport to the bottom as the last message grows
 *    during streaming (no manual work needed for height changes).
 *  - One instant `scrollToIndex("LAST")` per *new item* covers the discrete
 *    append case crisply.
 *  - A user wheel/key scroll-up unpins immediately; returning to the bottom
 *    (reported by Virtuoso) re-pins.
 */
export function useConversationAutoScroll(items: readonly unknown[]): ConversationAutoScrollController {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewport tracks the latest message. Starts pinned so a freshly
  // opened conversation lands at the bottom.
  const pinnedToBottom = useRef(true);
  // True only while the *user* is actively scrolling, so we can tell a real
  // scroll-up from the viewport leaving the bottom because streaming grew taller.
  const userScrolling = useRef(false);
  // Short window after a programmatic snap during which Virtuoso's transient
  // "left the bottom" reports must not be mistaken for a user scroll.
  const programmaticUntil = useRef(0);

  const releaseToUser = useCallback(() => {
    pinnedToBottom.current = false;
  }, []);

  useLayoutEffect(() => {
    if (items.length === 0 || !pinnedToBottom.current) {
      return;
    }
    programmaticUntil.current = performance.now() + 150;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, [items]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        releaseToUser();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        releaseToUser();
      }
    };
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("keydown", onKeyDown);
    };
  }, [releaseToUser]);

  const setUserScrolling = useCallback((scrolling: boolean) => {
    userScrolling.current = scrolling;
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    if (atBottom) {
      pinnedToBottom.current = true;
      return;
    }
    // Only a user-driven scroll away from the bottom unpins. Streaming growth and
    // our own programmatic snaps must not.
    if (userScrolling.current && performance.now() > programmaticUntil.current) {
      pinnedToBottom.current = false;
    }
  }, []);

  const followOutput = useCallback(() => (pinnedToBottom.current ? "auto" : false), []);

  return {
    virtuosoRef,
    containerRef,
    setUserScrolling,
    handleAtBottomStateChange,
    followOutput,
  };
}
