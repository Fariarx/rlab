import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { useRlabPlugins } from "../src/components/workspace/hooks/use-rlab-plugins";
import { loadRlabPlugins } from "../src/client/api/workspace-page-api";
import type { ComposerPluginLink } from "../src/lib/rlab-plugins";

vi.mock("../src/client/api/workspace-page-api", () => ({
  loadRlabPlugins: vi.fn(),
}));

const loadRlabPluginsMock = vi.mocked(loadRlabPlugins);

function Harness({
  toast,
  capture,
}: {
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (plugins: readonly ComposerPluginLink[]) => void;
}) {
  const plugins = useRlabPlugins({ toast });
  useEffect(() => {
    capture(plugins);
  }, [capture, plugins]);
  return null;
}

describe("useRlabPlugins", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads plugin links on mount", async () => {
    const plugins = [{ id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" }];
    loadRlabPluginsMock.mockResolvedValueOnce(plugins);
    const captured: { current: readonly ComposerPluginLink[] } = { current: [] };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          captured.current = next;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).toEqual(plugins));
    expect(loadRlabPluginsMock).toHaveBeenCalledTimes(1);
  });

  it("clears plugin links and reports load errors", async () => {
    loadRlabPluginsMock.mockRejectedValueOnce(new Error("plugin scan failed"));
    const toast = vi.fn(() => "toast-1");
    const captured: { current: readonly ComposerPluginLink[] } = { current: [{ id: "stale", label: "Stale", token: "$Stale" }] };

    render(
      <Harness
        toast={toast}
        capture={(next) => {
          captured.current = next;
        }}
      />,
    );

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ message: "plugin scan failed", severity: "error", duration: 3000 }));
    expect(captured.current).toEqual([]);
  });
});
