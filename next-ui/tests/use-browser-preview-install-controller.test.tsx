import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserPreview, loadBrowserPreviewInstallStatus } from "../src/client/api/settings-api";
import {
  type BrowserPreviewInstallController,
  useBrowserPreviewInstallController,
} from "../src/components/workspace/browser/use-browser-preview-install-controller";

vi.mock("../src/client/api/settings-api", () => ({
  installBrowserPreview: vi.fn(),
  loadBrowserPreviewInstallStatus: vi.fn(),
}));

const installBrowserPreviewMock = vi.mocked(installBrowserPreview);
const loadBrowserPreviewInstallStatusMock = vi.mocked(loadBrowserPreviewInstallStatus);

interface CapturedState {
  readonly controller: BrowserPreviewInstallController;
  readonly browserInstalled: boolean | null;
  readonly installBrowserError: string | null;
  readonly installingBrowser: boolean;
}

function Harness({
  active = true,
  capture,
}: {
  readonly active?: boolean;
  readonly capture: (state: CapturedState) => void;
}) {
  const [browserInstalled, setBrowserInstalled] = useState<boolean | null>(null);
  const [installBrowserError, setInstallBrowserError] = useState<string | null>(null);
  const [installingBrowser, setInstallingBrowser] = useState(false);
  const controller = useBrowserPreviewInstallController({
    active,
    browserInstalled,
    setBrowserInstalled,
    setInstallBrowserError,
    setInstallingBrowser,
  });

  useEffect(() => {
    capture({ browserInstalled, controller, installBrowserError, installingBrowser });
  }, [browserInstalled, capture, controller, installBrowserError, installingBrowser]);

  return null;
}

describe("useBrowserPreviewInstallController", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads browser install status when preview becomes active", async () => {
    loadBrowserPreviewInstallStatusMock.mockResolvedValueOnce(true);
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} />);

    await waitFor(() => expect(captured.current?.browserInstalled).toBe(true));
    expect(captured.current?.installBrowserError).toBeNull();
    expect(loadBrowserPreviewInstallStatusMock).toHaveBeenCalledTimes(1);
  });

  it("reports install status load errors instead of hiding them", async () => {
    loadBrowserPreviewInstallStatusMock.mockRejectedValueOnce(new Error("health endpoint failed"));
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} />);

    await waitFor(() => expect(captured.current?.installBrowserError).toBe("health endpoint failed"));
    expect(captured.current?.browserInstalled).toBe(false);
  });

  it("installs the browser and requires the health check to confirm installation", async () => {
    loadBrowserPreviewInstallStatusMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    installBrowserPreviewMock.mockResolvedValueOnce(undefined);
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} />);
    await waitFor(() => expect(captured.current?.browserInstalled).toBe(false));

    act(() => {
      captured.current?.controller.installPreviewBrowser();
    });

    await waitFor(() => expect(captured.current?.browserInstalled).toBe(true));
    expect(captured.current?.installingBrowser).toBe(false);
    expect(captured.current?.installBrowserError).toBeNull();
    expect(installBrowserPreviewMock).toHaveBeenCalledTimes(1);
    expect(loadBrowserPreviewInstallStatusMock).toHaveBeenCalledTimes(2);
  });

  it("reports successful install calls that are not confirmed by health status", async () => {
    loadBrowserPreviewInstallStatusMock.mockResolvedValueOnce(false).mockResolvedValueOnce(null);
    installBrowserPreviewMock.mockResolvedValueOnce(undefined);
    const captured: { current: CapturedState | null } = { current: null };

    render(<Harness capture={(state) => { captured.current = state; }} />);
    await waitFor(() => expect(captured.current?.browserInstalled).toBe(false));

    act(() => {
      captured.current?.controller.installPreviewBrowser();
    });

    await waitFor(() => expect(captured.current?.installBrowserError).toBe("Browser preview install status did not confirm installation."));
    expect(captured.current?.browserInstalled).toBe(false);
    expect(captured.current?.installingBrowser).toBe(false);
  });
});
