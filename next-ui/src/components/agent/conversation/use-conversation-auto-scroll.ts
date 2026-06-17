import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ConversationAutoScrollController {
  /** The scrolling viewport. */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** The content column inside the viewport; observed for height changes so the
   *  thread re-pins as messages stream or late content (images) grows. */
  readonly contentRef: RefObject<HTMLDivElement | null>;
  readonly showScrollToBottom: boolean;
  readonly scrollToBottom: () => void;
}

/** A finished thread is "at the bottom" within this many pixels of the end. */
const BOTTOM_THRESHOLD = 96;
/** Load older messages once the user scrolls within this many pixels of the top,
 *  a touch early so the next batch is ready before they hit the very edge. */
const TOP_THRESHOLD = 240;

export interface ConversationAutoScrollOptions {
  /** Called while scrolling near the top, to load/reveal older messages. The
   *  scroll container is passed so the caller can preserve its scroll position. */
  readonly onReachTop?: (container: HTMLDivElement) => void;
}

/**
 * Keeps the thread pinned to the newest message while leaving the user free to
 * scroll up and read history — on a plain native scroll container (no virtual
 * list, so there is no height estimation to land the viewport mid-thread).
 *
 *  - The pin state is derived purely from scroll position: at the bottom → pinned,
 *    scrolled up → released. Programmatic snaps land at the bottom and therefore
 *    keep it pinned, so there is no user-vs-programmatic race to arbitrate.
 *  - A ResizeObserver on the content re-snaps to the bottom whenever it grows
 *    while pinned: streaming tokens, expanding blocks, and images that finish
 *    loading after the initial layout. This is what makes "opens at the bottom"
 *    reliable even for long threads with tall, late-measuring messages.
 */
export function useConversationAutoScroll(items: readonly unknown[], options?: ConversationAutoScrollOptions): ConversationAutoScrollController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Starts pinned so a freshly opened conversation lands at the bottom.
  const pinnedToBottom = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // Held in a ref so the scroll listener stays stable across renders.
  const onReachTopRef = useRef(options?.onReachTop);
  onReachTopRef.current = options?.onReachTop;

  const isAtBottom = useCallback((element: HTMLDivElement): boolean => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
  }, []);

  const snapToBottom = useCallback((behavior: ScrollBehavior) => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    // scrollTo isn't implemented in jsdom and is the only way to get smooth
    // behavior; fall back to the always-available scrollTop for instant snaps.
    if (behavior === "smooth" && typeof element.scrollTo === "function") {
      element.scrollTo({ top: element.scrollHeight, behavior });
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, []);

  const setPinned = useCallback((value: boolean) => {
    pinnedToBottom.current = value;
    setShowScrollToBottom(!value);
  }, []);

  // Re-pin on new items (append/open). Streaming growth within a message is
  // covered by the ResizeObserver below.
  useLayoutEffect(() => {
    if (items.length > 0 && pinnedToBottom.current) {
      snapToBottom("auto");
    }
  }, [items, snapToBottom]);

  // Track the user's pin state from raw scroll position.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const onScroll = () => {
      setPinned(isAtBottom(element));
      if (element.scrollTop <= TOP_THRESHOLD) {
        onReachTopRef.current?.(element);
      }
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [isAtBottom, setPinned]);

  // Keep glued to the bottom as content grows while pinned (streaming + images).
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) {
        snapToBottom("auto");
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [snapToBottom]);

  const scrollToBottom = useCallback(() => {
    setPinned(true);
    snapToBottom("smooth");
  }, [setPinned, snapToBottom]);

  return { containerRef, contentRef, showScrollToBottom, scrollToBottom };
}
