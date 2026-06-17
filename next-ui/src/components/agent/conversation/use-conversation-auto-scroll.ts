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
 * Smoothness matters here: the earlier version snapped from two places at once
 * (a per-render layout effect *and* a ResizeObserver) which fought each other and
 * the browser's scroll anchoring, so streaming looked jittery. Now there is a
 * single snap path:
 *
 *  - One synchronous, pre-paint snap when the conversation opens, so it lands at
 *    the bottom with no top-then-jump flash.
 *  - A single ResizeObserver drives every subsequent stick (streaming tokens,
 *    expanding blocks, late-loading images), coalesced by the browser to one
 *    callback per frame. The container sets `overflow-anchor: none` so the
 *    browser doesn't also nudge the scroll position.
 *  - Pin state is derived purely from scroll position: at the bottom → pinned,
 *    scrolled up → released, with no user-vs-programmatic race to arbitrate.
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
  const hasItems = items.length > 0;

  const isAtBottom = useCallback((element: HTMLDivElement): boolean => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
  }, []);

  const snapInstant = useCallback(() => {
    const element = containerRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, []);

  const setPinned = useCallback((value: boolean) => {
    if (pinnedToBottom.current === value) {
      return; // avoid redundant state churn while snapping
    }
    pinnedToBottom.current = value;
    setShowScrollToBottom(!value);
  }, []);

  // Land at the bottom the moment the thread first has content — synchronously,
  // before paint, so there's no top-then-jump flash on open. Runs once per mount
  // (the thread is keyed by conversation id, so it remounts per open).
  const didInitialSnap = useRef(false);
  useLayoutEffect(() => {
    if (!didInitialSnap.current && hasItems && pinnedToBottom.current) {
      didInitialSnap.current = true;
      snapInstant();
    }
  }, [hasItems, snapInstant]);

  // Release the pin only on a genuine upward user scroll, and re-pin once the
  // user returns to the bottom. Deriving release from `isAtBottom` alone is
  // fragile: when the agent appends tool blocks faster than we re-snap, the
  // bottom distance momentarily exceeds the threshold between our snap and the
  // (async) scroll event, which would falsely unpin. A growing thread only ever
  // moves scrollTop *down* via our own snap, so a scrollTop *decrease* is the
  // unambiguous signal that the user scrolled up themselves.
  const lastScrollTop = useRef(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    lastScrollTop.current = element.scrollTop;
    const onScroll = () => {
      const top = element.scrollTop;
      const scrolledUp = top < lastScrollTop.current - 2;
      lastScrollTop.current = top;
      if (scrolledUp && !isAtBottom(element)) {
        setPinned(false);
      } else if (isAtBottom(element)) {
        setPinned(true);
      }
      if (top <= TOP_THRESHOLD) {
        onReachTopRef.current?.(element);
      }
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [isAtBottom, setPinned]);

  // The single stick mechanism: keep glued to the bottom as content grows while
  // pinned (streaming + images). The browser batches resize notifications to once
  // per frame, so this writes scrollTop at most once per frame — no thrashing.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) {
        snapInstant();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [snapInstant]);

  // Background tabs throttle the ResizeObserver, so a thread that grew while
  // hidden comes back scrolled away from the bottom. Re-stick on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pinnedToBottom.current) {
        return;
      }
      snapInstant();
      // Layout may not be settled the instant the tab is shown; snap again next frame.
      requestAnimationFrame(() => {
        if (pinnedToBottom.current) {
          snapInstant();
        }
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [snapInstant]);

  const scrollToBottom = useCallback(() => {
    setPinned(true);
    const element = containerRef.current;
    if (element?.scrollTo) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    } else {
      snapInstant();
    }
  }, [setPinned, snapInstant]);

  return { containerRef, contentRef, showScrollToBottom, scrollToBottom };
}
