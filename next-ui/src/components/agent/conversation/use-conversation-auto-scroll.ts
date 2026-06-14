import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

export interface ConversationAutoScrollController {
  readonly virtuosoRef: RefObject<VirtuosoHandle | null>;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly setUserScrolling: (scrolling: boolean) => void;
  readonly handleAtBottomStateChange: (atBottom: boolean) => void;
  readonly followOutput: () => "auto" | false;
}

export function useConversationAutoScroll(items: readonly unknown[]): ConversationAutoScrollController {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewport is pinned to the latest message. Starts pinned so a
  // freshly opened conversation lands at the bottom; flips off when the user
  // scrolls up to read history so streaming updates don't yank them back down.
  const pinnedToBottom = useRef(true);
  // True only while the *user* is actively scrolling. We use it to distinguish a
  // user scroll-up (which should unpin) from the viewport leaving the bottom
  // simply because streaming content grew taller.
  const userScrolling = useRef(false);
  const programmaticScrollUntil = useRef(0);
  const convergenceTimer = useRef<number | null>(null);

  const scrollerEl = useCallback(
    (): HTMLElement | null => (containerRef.current?.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement | null),
    [],
  );

  const pinToBottom = useCallback(() => {
    if (!pinnedToBottom.current) {
      return;
    }
    programmaticScrollUntil.current = performance.now() + 300;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
    const scroller = scrollerEl();
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [scrollerEl]);

  const releaseToUser = useCallback(() => {
    pinnedToBottom.current = false;
    if (convergenceTimer.current !== null) {
      clearInterval(convergenceTimer.current);
      convergenceTimer.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (items.length === 0) {
      return;
    }
    pinToBottom();
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [items, pinToBottom]);

  useLayoutEffect(() => {
    pinnedToBottom.current = true;
    let atBottomTicks = 0;
    let elapsed = 0;
    let lastHeight = -1;
    pinToBottom();
    convergenceTimer.current = window.setInterval(() => {
      elapsed += 100;
      pinToBottom();
      const scroller = scrollerEl();
      const height = scroller ? scroller.scrollHeight : 0;
      const distance = scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : 0;
      const stable = height === lastHeight;
      lastHeight = height;
      atBottomTicks = distance <= 4 && stable ? atBottomTicks + 1 : 0;
      if (convergenceTimer.current === null || elapsed >= 6000 || atBottomTicks >= 3) {
        if (convergenceTimer.current !== null) {
          clearInterval(convergenceTimer.current);
          convergenceTimer.current = null;
        }
      }
    }, 100);
    return () => {
      if (convergenceTimer.current !== null) {
        clearInterval(convergenceTimer.current);
        convergenceTimer.current = null;
      }
    };
  }, [pinToBottom, scrollerEl]);

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
    const onTouchMove = () => {
      if (convergenceTimer.current !== null) {
        releaseToUser();
        return;
      }
      const scroller = scrollerEl();
      if (scroller && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 24) {
        releaseToUser();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        releaseToUser();
      }
    };
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("keydown", onKeyDown);
    };
  }, [releaseToUser, scrollerEl]);

  const setUserScrolling = useCallback((scrolling: boolean) => {
    userScrolling.current = scrolling;
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    if (atBottom) {
      pinnedToBottom.current = true;
    } else if (userScrolling.current && performance.now() > programmaticScrollUntil.current) {
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
