import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserPreview, loadBrowserPreviewInstalled } from "../src/client/api/settings-api";
import { type BrowserPreviewSetupController, useBrowserPreviewSetupController } from "../src/components/settings/use-browser-preview-setup-controller";

vi.mock("../src/client/api/settings-api", () => ({
  installBrowserPreview: vi.fn(),
  loadBrowserPreviewInstalled: vi.fn(),
}));

const installBrowserPreviewMock = vi.mocked(installBrowserPreview);
const loadBrowserPreviewInstalledMock = vi.mocked(loadBrowserPreviewInstalled);

function Harness({ capture }: { readonly capture: (controller: BrowserPreviewSetupController) => void }) {
  const controller = useBrowserPreviewSetupController();
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useBrowserPreviewSetupController", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads browser preview installation status on mount", async () => {
    loadBrowserPreviewInstalledMock.mockResolvedValueOnce(true);
    const controller: { current: BrowserPreviewSetupController | null } = { current: null };

    render(
      <Harness
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.store.installed).toBe(true));
    expect(controller.current?.store.error).toBeNull();
    expect(loadBrowserPreviewInstalledMock).toHaveBeenCalledTimes(1);
  });

  it("installs the browser preview runtime and refreshes installation status", async () => {
    loadBrowserPreviewInstalledMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    installBrowserPreviewMock.mockResolvedValueOnce(undefined);
    const controller: { current: BrowserPreviewSetupController | null } = { current: null };

    render(
      <Harness
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.store.installed).toBe(false));

    act(() => {
      controller.current?.installBrowser();
    });

    await waitFor(() => expect(controller.current?.store.installed).toBe(true));
    expect(controller.current?.store.installing).toBe(false);
    expect(controller.current?.store.error).toBeNull();
    expect(installBrowserPreviewMock).toHaveBeenCalledTimes(1);
    expect(loadBrowserPreviewInstalledMock).toHaveBeenCalledTimes(2);
  });

  it("reports status load errors instead of silently treating them as not installed", async () => {
    loadBrowserPreviewInstalledMock.mockRejectedValueOnce(new Error("playwright check failed"));
    const controller: { current: BrowserPreviewSetupController | null } = { current: null };

    render(
      <Harness
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.store.error).toBe("playwright check failed"));
    expect(controller.current?.store.installed).toBe(false);
  });
});
