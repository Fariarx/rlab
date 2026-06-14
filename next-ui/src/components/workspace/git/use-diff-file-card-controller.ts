import { type RefObject, useEffect, useRef, useState } from "react";
import { DiffFileCardStore } from "./git-panel-store";

export interface DiffFileCardController {
  readonly handleHeaderClick: () => void;
  readonly open: boolean;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly sentinelRef: RefObject<HTMLDivElement | null>;
  readonly stuck: boolean;
}

export function useDiffFileCardController({
  autoOpenLineLimit,
  focusSignal,
  hasLines,
  lineCount,
  onFirstOpen,
  scrollRef,
}: {
  readonly autoOpenLineLimit: number;
  readonly focusSignal: number;
  readonly hasLines: boolean;
  readonly lineCount: number;
  readonly onFirstOpen?: () => void;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
}): DiffFileCardController {
  const [store] = useState(() => new DiffFileCardStore());
  const { open, setOpen, touched, setTouched, stuck, setStuck } = store;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (touched || !hasLines || lineCount === 0 || lineCount > autoOpenLineLimit) {
      return;
    }
    setOpen(true);
  }, [autoOpenLineLimit, hasLines, lineCount, setOpen, touched]);

  useEffect(() => {
    if (focusSignal <= 0) {
      return;
    }
    setTouched(true);
    setOpen(true);
    onFirstOpen?.();
    const frame = requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [focusSignal, onFirstOpen, setOpen, setTouched]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef?.current;
    if (!open || !sentinel || !root || typeof IntersectionObserver === "undefined") {
      setStuck(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { root });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, scrollRef, setStuck]);

  const handleHeaderClick = () => {
    setTouched(true);
    setOpen((value) => {
      const next = !value;
      if (next) {
        onFirstOpen?.();
      }
      return next;
    });
  };

  return { handleHeaderClick, open, rootRef, sentinelRef, stuck };
}
