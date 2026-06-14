import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerLayoutController } from "../src/components/agent/composer/use-composer-layout-controller";

const originalResizeObserver = globalThis.ResizeObserver;
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

interface CapturedController {
  readonly clearComposerBorderHover: () => void;
  readonly openOptionsMenu: (anchorEl: HTMLElement) => void;
  readonly updateComposerBorderHover: (event: React.PointerEvent<HTMLDivElement>) => void;
}

class TestResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

function Harness({
  composerValue,
  expanded,
  onOverlayLiftChange = vi.fn(),
  onTagsHeightChange = vi.fn(),
  setExpanded = vi.fn(),
  setLimitOpen = vi.fn(),
  setModeMenuAnchor = vi.fn(),
  setOptionsMenuMaxHeight = vi.fn(),
  setOverlayLift = vi.fn(),
  capture,
}: {
  readonly composerValue: string;
  readonly expanded: boolean;
  readonly onOverlayLiftChange?: (lift: number) => void;
  readonly onTagsHeightChange?: (height: number) => void;
  readonly setExpanded?: (value: boolean) => void;
  readonly setLimitOpen?: (value: boolean) => void;
  readonly setModeMenuAnchor?: (value: HTMLElement | null) => void;
  readonly setOptionsMenuMaxHeight?: (value: number | undefined) => void;
  readonly setOverlayLift?: (value: number) => void;
  readonly capture?: (controller: CapturedController) => void;
}) {
  const controller = useComposerLayoutController({
    composerValue,
    expanded,
    limitLayoutKey: "ready",
    modeMenuAnchor: null,
    onOverlayLiftChange,
    onTagsHeightChange,
    setExpanded,
    setLimitOpen,
    setModeMenuAnchor,
    setOptionsMenuMaxHeight,
    setOverlayLift,
  });

  useEffect(() => {
    capture?.(controller);
  }, [capture, controller]);

  return (
    <div ref={controller.rootRef}>
      <div ref={controller.tagsRef} />
      <div ref={controller.composerBarRef} />
      <textarea ref={controller.textareaRef} />
      <ul ref={controller.optionsMenuListRef} />
    </div>
  );
}

describe("useComposerLayoutController", () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
    if (originalScrollHeight) {
      Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight);
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.restoreAllMocks();
  });

  it("reports tag row height through ResizeObserver-backed measurement", async () => {
    globalThis.ResizeObserver = TestResizeObserver;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 44,
    });
    const onTagsHeightChange = vi.fn();

    render(<Harness composerValue="" expanded={false} onTagsHeightChange={onTagsHeightChange} />);

    await waitFor(() => expect(onTagsHeightChange).toHaveBeenCalledWith(44));
  });

  it("measures multiline overlay lift from textarea and root geometry", () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 80,
    });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { bottom: 0, height: 0, left: 0, right: 0, top: this instanceof HTMLTextAreaElement ? 80 : 100, width: 0, x: 0, y: this instanceof HTMLTextAreaElement ? 80 : 100, toJSON: () => ({}) };
    };
    const setExpanded = vi.fn();
    const setOverlayLift = vi.fn();
    const onOverlayLiftChange = vi.fn();

    render(
      <Harness
        composerValue={"hello\nworld"}
        expanded
        onOverlayLiftChange={onOverlayLiftChange}
        setExpanded={setExpanded}
        setOverlayLift={setOverlayLift}
      />,
    );

    expect(setExpanded).toHaveBeenCalledWith(true);
    expect(setOverlayLift).toHaveBeenCalledWith(28);
    expect(onOverlayLiftChange).toHaveBeenCalledWith(28);
  });

  it("updates and clears composer border hover variables", async () => {
    let captured: CapturedController | null = null;
    render(<Harness composerValue="" expanded={false} capture={(controller) => { captured = controller; }} />);

    await waitFor(() => expect(captured).not.toBeNull());
    act(() => {
      captured?.updateComposerBorderHover({ clientX: 16, clientY: 24 } as React.PointerEvent<HTMLDivElement>);
    });

    const composerBar = document.querySelector("div > div:nth-child(2)");
    expect(composerBar).toBeInstanceOf(HTMLElement);
    expect((composerBar as HTMLElement).style.getPropertyValue("--composer-border-x")).toBe("16px");
    expect((composerBar as HTMLElement).style.getPropertyValue("--composer-border-y")).toBe("24px");
    expect((composerBar as HTMLElement).style.getPropertyValue("--composer-border-hover-opacity")).toBe("1");

    act(() => {
      captured?.clearComposerBorderHover();
    });

    expect((composerBar as HTMLElement).style.getPropertyValue("--composer-border-hover-opacity")).toBe("0");
  });

  it("opens the options menu with a viewport-bounded max height", async () => {
    const setLimitOpen = vi.fn();
    const setModeMenuAnchor = vi.fn();
    const setOptionsMenuMaxHeight = vi.fn();
    let captured: CapturedController | null = null;
    render(
      <Harness
        composerValue=""
        expanded={false}
        capture={(controller) => { captured = controller; }}
        setLimitOpen={setLimitOpen}
        setModeMenuAnchor={setModeMenuAnchor}
        setOptionsMenuMaxHeight={setOptionsMenuMaxHeight}
      />,
    );
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 50, width: 0, x: 0, y: 50, toJSON: () => ({}) });

    await waitFor(() => expect(captured).not.toBeNull());
    act(() => {
      captured?.openOptionsMenu(anchor);
    });

    expect(setLimitOpen).toHaveBeenCalledWith(false);
    expect(setOptionsMenuMaxHeight).toHaveBeenCalledWith(38);
    expect(setModeMenuAnchor).toHaveBeenCalledWith(anchor);
  });
});
