import { act, render } from "@testing-library/react";
import { observer } from "mobx-react-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitViewController } from "../src/components/workspace/git/use-git-view-controller";
import type { I18nApi } from "../src/i18n/I18nProvider";

const t = ((key: string) => key) as I18nApi["t"];
const originalVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

function gitStatusResponse(): Response {
  return Response.json({ branch: "main", branches: ["main"], ahead: 0, behind: 0, clean: true, files: [] });
}

const Probe = observer(function Probe({ paused = false, active = true }: { readonly paused?: boolean; readonly active?: boolean }) {
  useGitViewController({
    cwd: "/repo",
    active,
    lastTurnDiffs: [],
    focusNonce: 0,
    reloadSignal: 0,
    autoRefreshPaused: paused,
    t,
  });
  return null;
});

describe("useGitViewController", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(gitStatusResponse());
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalVisibilityState) {
      Object.defineProperty(Document.prototype, "visibilityState", originalVisibilityState);
    }
  });

  it("refreshes git status quietly on window focus and a slow visible interval", async () => {
    render(<Probe />);

    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("pauses auto-refresh while a review comment textarea is active", async () => {
    const { rerender } = render(<Probe paused />);

    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Probe paused={false} />);
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
