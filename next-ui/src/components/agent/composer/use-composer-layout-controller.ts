import type { PointerEvent, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface PopoverPositionActions {
  readonly updatePosition: () => void;
}

interface UseComposerLayoutControllerInput {
  readonly composerValue: string;
  readonly composerFocused: boolean;
  readonly expanded: boolean;
  readonly limitLayoutKey: string;
  readonly modeMenuAnchor: HTMLElement | null;
  readonly onOverlayLiftChange?: (lift: number) => void;
  readonly onTagsHeightChange?: (height: number) => void;
  readonly setExpanded: (value: boolean) => void;
  readonly setLimitOpen: (value: boolean) => void;
  readonly setModeMenuAnchor: (value: HTMLElement | null) => void;
  readonly setOptionsMenuMaxHeight: (value: number | undefined) => void;
  readonly setOverlayLift: (value: number) => void;
}

interface UseComposerLayoutControllerResult {
  readonly clearComposerBorderHover: () => void;
  readonly composerBarRef: RefObject<HTMLDivElement | null>;
  readonly openOptionsMenu: (anchorEl: HTMLElement) => void;
  readonly optionsMenuActionRef: RefObject<PopoverPositionActions | null>;
  readonly optionsMenuListRef: RefObject<HTMLUListElement | null>;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly tagsRef: RefObject<HTMLDivElement | null>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly updateComposerBorderHover: (event: PointerEvent<HTMLDivElement>) => void;
  readonly updateOptionsMenuPosition: () => void;
}

function singleRowHeight(el: HTMLTextAreaElement): number {
  if (el.clientHeight > 0) {
    return el.clientHeight;
  }
  const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight);
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : el.scrollHeight;
}

export function useComposerLayoutController({
  composerValue,
  composerFocused,
  expanded,
  limitLayoutKey,
  modeMenuAnchor,
  onOverlayLiftChange,
  onTagsHeightChange,
  setExpanded,
  setLimitOpen,
  setModeMenuAnchor,
  setOptionsMenuMaxHeight,
  setOverlayLift,
}: UseComposerLayoutControllerInput): UseComposerLayoutControllerResult {
  const onOverlayLiftChangeRef = useRef(onOverlayLiftChange);
  onOverlayLiftChangeRef.current = onOverlayLiftChange;
  const optionsMenuActionRef = useRef<PopoverPositionActions | null>(null);
  const optionsMenuListRef = useRef<HTMLUListElement | null>(null);
  const optionsMenuPositionFrameRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composerBarRef = useRef<HTMLDivElement | null>(null);
  const singleRowRef = useRef(0);
  const overlayLiftRef = useRef(0);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    if (singleRowRef.current === 0 && !expanded) {
      singleRowRef.current = singleRowHeight(el);
    }
    const baseline = singleRowRef.current || 24;
    const hasHorizontalOverflow = el.scrollWidth > el.clientWidth + 1;
    const hasVerticalOverflow = el.scrollHeight > el.clientHeight + 1;
    const needsMultiline = composerValue.length > 0 && (composerValue.includes("\n") || el.scrollHeight > baseline * 1.5 || (composerFocused && (hasHorizontalOverflow || hasVerticalOverflow)));
    if (expanded !== needsMultiline) {
      setExpanded(needsMultiline);
    }
    const root = rootRef.current;
    let nextLift = 0;
    if (needsMultiline && expanded && root) {
      const overlayTop = el.getBoundingClientRect().top - 8;
      nextLift = Math.max(0, Math.round(root.getBoundingClientRect().top - overlayTop));
    }
    if (overlayLiftRef.current !== nextLift) {
      overlayLiftRef.current = nextLift;
      setOverlayLift(nextLift);
      onOverlayLiftChangeRef.current?.(nextLift);
    }
  }, [composerFocused, composerValue, expanded, setExpanded, setOverlayLift]);

  useEffect(() => {
    const el = tagsRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      onTagsHeightChange?.(0);
      return;
    }
    const report = () => onTagsHeightChange?.(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onTagsHeightChange?.(0);
    };
  }, [onTagsHeightChange]);

  const updateComposerBorderHover = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const composerBar = composerBarRef.current;
    if (!composerBar) {
      return;
    }
    const rect = composerBar.getBoundingClientRect();
    composerBar.style.setProperty("--composer-border-x", `${Math.round(event.clientX - rect.left)}px`);
    composerBar.style.setProperty("--composer-border-y", `${Math.round(event.clientY - rect.top)}px`);
    composerBar.style.setProperty("--composer-border-hover-opacity", "1");
  }, []);

  const clearComposerBorderHover = useCallback(() => {
    composerBarRef.current?.style.setProperty("--composer-border-hover-opacity", "0");
  }, []);

  const updateOptionsMenuPosition = useCallback(() => {
    optionsMenuActionRef.current?.updatePosition();
  }, []);

  const scheduleOptionsMenuPositionUpdate = useCallback(() => {
    if (optionsMenuPositionFrameRef.current !== null) {
      cancelAnimationFrame(optionsMenuPositionFrameRef.current);
    }
    optionsMenuPositionFrameRef.current = requestAnimationFrame(() => {
      optionsMenuPositionFrameRef.current = null;
      updateOptionsMenuPosition();
    });
  }, [updateOptionsMenuPosition]);

  useEffect(() => {
    return () => {
      if (optionsMenuPositionFrameRef.current !== null) {
        cancelAnimationFrame(optionsMenuPositionFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const list = optionsMenuListRef.current;
    if (!modeMenuAnchor || !list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(scheduleOptionsMenuPositionUpdate);
    observer.observe(list);
    return () => observer.disconnect();
  }, [modeMenuAnchor, scheduleOptionsMenuPositionUpdate]);

  useLayoutEffect(() => {
    void limitLayoutKey;
    if (modeMenuAnchor) {
      scheduleOptionsMenuPositionUpdate();
    }
  }, [limitLayoutKey, modeMenuAnchor, scheduleOptionsMenuPositionUpdate]);

  const openOptionsMenu = useCallback((anchorEl: HTMLElement) => {
    setLimitOpen(false);
    setOptionsMenuMaxHeight(Math.max(0, Math.floor(anchorEl.getBoundingClientRect().top - 12)));
    setModeMenuAnchor(anchorEl);
  }, [setLimitOpen, setModeMenuAnchor, setOptionsMenuMaxHeight]);

  return {
    clearComposerBorderHover,
    composerBarRef,
    openOptionsMenu,
    optionsMenuActionRef,
    optionsMenuListRef,
    rootRef,
    tagsRef,
    textareaRef,
    updateComposerBorderHover,
    updateOptionsMenuPosition,
  };
}
