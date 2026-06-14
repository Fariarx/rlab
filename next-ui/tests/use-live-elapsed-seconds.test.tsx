import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveElapsedSeconds } from "../src/components/agent/message/use-live-elapsed-seconds";

function Harness({
  active,
  startedAtMs,
}: {
  readonly active: boolean;
  readonly startedAtMs?: number;
}) {
  const elapsed = useLiveElapsedSeconds({ active, startedAtMs });
  return <span>{elapsed ?? "null"}</span>;
}

describe("useLiveElapsedSeconds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports elapsed seconds immediately and updates while active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:07.000Z"));

    render(
      <Harness
        active
        startedAtMs={new Date("2026-06-10T12:00:00.000Z").getTime()}
      />,
    );

    expect(screen.getByText("7")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("returns null when inactive", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:07.000Z"));

    render(
      <Harness
        active={false}
        startedAtMs={new Date("2026-06-10T12:00:00.000Z").getTime()}
      />,
    );

    expect(screen.getByText("null")).toBeInTheDocument();
  });
});
