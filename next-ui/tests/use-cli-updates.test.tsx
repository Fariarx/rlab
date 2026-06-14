import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import type { ToastOptions } from "../src/components/ui";
import { type CliUpdatesController, useCliUpdates } from "../src/components/workspace/hooks/use-cli-updates";
import { loadCliUpdates, updateAgentCli, type CliUpdateInfo, type CliUpdateSnapshot } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/client/api/workspace-page-api")>();
  return {
    ...actual,
    loadCliUpdates: vi.fn(),
    updateAgentCli: vi.fn(),
  };
});

const loadCliUpdatesMock = vi.mocked(loadCliUpdates);
const updateAgentCliMock = vi.mocked(updateAgentCli);

const t: I18nApi["t"] = (key, params) => {
  if (typeof params?.agent === "string") {
    return `${key}:${params.agent}`;
  }
  if (typeof params?.error === "string") {
    return `${key}:${params.error}`;
  }
  return key;
};

const update: CliUpdateInfo = {
  agent: "codex",
  agentName: "Codex",
  packageName: "@openai/codex",
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  command: "npm i -g @openai/codex",
};

function snapshot(updates: readonly CliUpdateInfo[]): CliUpdateSnapshot {
  return { checkedAt: 1, checking: false, updates, errors: {} };
}

function Harness({
  toast,
  reloadAgentStatus,
  capture,
}: {
  readonly toast: (options: ToastOptions) => string;
  readonly reloadAgentStatus: () => void;
  readonly capture: (controller: CliUpdatesController) => void;
}) {
  const controller = useCliUpdates({ reloadAgentStatus, t, toast });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useCliUpdates", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads CLI updates on mount", async () => {
    loadCliUpdatesMock.mockResolvedValueOnce(snapshot([update]));
    const controller: { current: CliUpdatesController | null } = { current: null };

    render(<Harness toast={vi.fn(() => "toast-1")} reloadAgentStatus={vi.fn()} capture={(next) => { controller.current = next; }} />);

    await waitFor(() => expect(controller.current?.snapshot.updates).toEqual([update]));
    expect(loadCliUpdatesMock).toHaveBeenCalledWith(false);
  });

  it("updates the selected CLI and refreshes the snapshot", async () => {
    loadCliUpdatesMock.mockResolvedValueOnce(snapshot([update])).mockResolvedValueOnce(snapshot([]));
    updateAgentCliMock.mockResolvedValueOnce();
    const toast = vi.fn(() => "toast-1");
    const reloadAgentStatus = vi.fn();
    const controller: { current: CliUpdatesController | null } = { current: null };

    render(<Harness toast={toast} reloadAgentStatus={reloadAgentStatus} capture={(next) => { controller.current = next; }} />);
    await waitFor(() => expect(controller.current?.snapshot.updates).toEqual([update]));

    await act(async () => {
      await controller.current?.updateCli(update);
    });

    expect(updateAgentCliMock).toHaveBeenCalledWith("codex");
    expect(reloadAgentStatus).toHaveBeenCalledTimes(1);
    expect(loadCliUpdatesMock).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(controller.current?.snapshot.updates).toEqual([]));
    expect(toast).toHaveBeenCalledWith({ message: "cliUpdateStarted:Codex", severity: "info", duration: 2500 });
    expect(toast).toHaveBeenCalledWith({ message: "cliUpdateComplete:Codex", severity: "success", duration: 2500 });
  });

  it("surfaces manual update failures", async () => {
    loadCliUpdatesMock.mockResolvedValueOnce(snapshot([update]));
    updateAgentCliMock.mockRejectedValueOnce(new Error("install failed"));
    const toast = vi.fn(() => "toast-1");
    const controller: { current: CliUpdatesController | null } = { current: null };

    render(<Harness toast={toast} reloadAgentStatus={vi.fn()} capture={(next) => { controller.current = next; }} />);
    await waitFor(() => expect(controller.current?.snapshot.updates).toEqual([update]));

    await act(async () => {
      await controller.current?.updateCli(update);
    });

    await waitFor(() => expect(controller.current?.busyAgent).toBeNull());
    expect(toast).toHaveBeenCalledWith({ message: "cliUpdateFailed:install failed", severity: "error", duration: 5000 });
  });
});
