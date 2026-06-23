import { cleanup, render } from "@testing-library/react";
import { act, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import type { ToastOptions } from "../src/components/ui";
import { useAppVersionReload } from "../src/components/workspace/hooks/use-app-version-reload";
import { loadAppVersion } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", () => ({
  loadAppVersion: vi.fn(),
}));

const loadAppVersionMock = vi.mocked(loadAppVersion);

const t: I18nApi["t"] = (key) => key;

function Harness({
  toast,
  pollMs = 1000,
  reloadApp = vi.fn(),
}: {
  readonly toast: (options: ToastOptions) => string;
  readonly pollMs?: number;
  readonly reloadApp?: () => void;
}) {
  useAppVersionReload({ t, toast, pollMs, reloadApp });
  return null;
}

describe("useAppVersionReload", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("does not prompt for the initial version", async () => {
    vi.useFakeTimers();
    loadAppVersionMock.mockResolvedValue("version-1");
    const toast = vi.fn<(options: ToastOptions) => string>(() => "toast-1");

    render(<Harness toast={toast} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadAppVersionMock).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("prompts once when the server version changes", async () => {
    vi.useFakeTimers();
    loadAppVersionMock.mockResolvedValueOnce("version-1").mockResolvedValue("version-2");
    const toast = vi.fn<(options: ToastOptions) => string>(() => "toast-1");
    const reloadApp = vi.fn();

    render(<Harness toast={toast} reloadApp={reloadApp} />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(loadAppVersionMock).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "newVersionAvailable",
      severity: "info",
      duration: 0,
    }));

    const promptToast = toast.mock.calls[0]?.[0];
    expect(promptToast).toBeDefined();
    const action = promptToast?.action;
    expect(isValidElement<{ readonly "aria-label": string; readonly onClick: () => void }>(action)).toBe(true);
    if (isValidElement<{ readonly "aria-label": string; readonly onClick: () => void }>(action)) {
      expect(action.props["aria-label"]).toBe("reloadApp");
      action.props.onClick();
    }
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });
});
