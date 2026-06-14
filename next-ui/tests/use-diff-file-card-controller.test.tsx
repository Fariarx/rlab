import { act, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DiffFileCardController,
  useDiffFileCardController,
} from "../src/components/workspace/git/use-diff-file-card-controller";

const Harness = observer(function Harness({
  autoOpenLineLimit = 240,
  focusSignal = 0,
  hasLines,
  lineCount,
  onFirstOpen = vi.fn(),
  onSnapshot,
}: {
  readonly autoOpenLineLimit?: number;
  readonly focusSignal?: number;
  readonly hasLines: boolean;
  readonly lineCount: number;
  readonly onFirstOpen?: () => void;
  readonly onSnapshot?: (controller: DiffFileCardController) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const controller = useDiffFileCardController({
    autoOpenLineLimit,
    focusSignal,
    hasLines,
    lineCount,
    onFirstOpen,
    scrollRef,
  });

  useEffect(() => {
    onSnapshot?.(controller);
  }, [controller, onSnapshot]);

  return (
    <div ref={scrollRef}>
      <div ref={controller.rootRef}>
        <div ref={controller.sentinelRef} />
        <button type="button" onClick={controller.handleHeaderClick}>
          toggle
        </button>
        <span>{controller.open ? "open" : "closed"}</span>
      </div>
    </div>
  );
});

describe("useDiffFileCardController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-opens loaded small diffs", async () => {
    render(<Harness hasLines lineCount={12} />);

    await waitFor(() => expect(screen.getByText("open")).toBeInTheDocument());
  });

  it("keeps large diffs collapsed until user action", () => {
    render(<Harness hasLines lineCount={300} />);

    expect(screen.getByText("closed")).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "toggle" }).click();
    });

    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("opens and scrolls the card for external focus requests", async () => {
    const scrollIntoView = vi.fn();
    const onFirstOpen = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<Harness hasLines={false} lineCount={0} focusSignal={3} onFirstOpen={onFirstOpen} />);

    await waitFor(() => expect(screen.getByText("open")).toBeInTheDocument());
    expect(onFirstOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" }));
  });
});
