import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { type AgentLimitsController, useAgentLimits } from "../src/components/workspace/hooks/use-agent-limits";
import { loadAgentLimits } from "../src/client/api/workspace-page-api";
import type { AgentRateLimitMap } from "../src/lib/agent-limits";
import type { I18nApi } from "../src/i18n/I18nProvider";

vi.mock("../src/client/api/workspace-page-api", () => ({
  loadAgentLimits: vi.fn(),
}));

const loadAgentLimitsMock = vi.mocked(loadAgentLimits);

const t: I18nApi["t"] = (key) => key;

function limits(agent: string): AgentRateLimitMap {
  return {
    [agent]: {
      updatedAt: 1000,
      windows: [{ kind: "daily", usedPercent: 12 }],
    },
  };
}

function Harness({
  toast,
  capture,
}: {
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (controller: AgentLimitsController) => void;
}) {
  const controller = useAgentLimits({ t, toast });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useAgentLimits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("loads limits on mount", async () => {
    const snapshot = { limits: limits("codex") };
    loadAgentLimitsMock.mockResolvedValueOnce(snapshot);
    const controller: { current: AgentLimitsController | null } = { current: null };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.limits).toEqual(snapshot.limits));
    expect(controller.current?.loaded).toBe(true);
    expect(loadAgentLimitsMock).toHaveBeenCalledWith(undefined, false);
  });

  it("refreshes supported agents on demand", async () => {
    loadAgentLimitsMock.mockResolvedValueOnce({ limits: {} }).mockResolvedValueOnce({ limits: limits("codex"), refreshError: "soft error" });
    const controller: { current: AgentLimitsController | null } = { current: null };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.loaded).toBe(true));

    await act(async () => {
      controller.current?.refresh("codex", true);
    });

    await waitFor(() => expect(controller.current?.limits).toEqual(limits("codex")));
    expect(loadAgentLimitsMock).toHaveBeenLastCalledWith("codex", true);
    expect(controller.current?.refreshing.codex).toBe(false);
    expect(controller.current?.refreshErrors.codex).toBe("soft error");
  });

  it("throttles repeated supported on-demand refreshes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    loadAgentLimitsMock.mockResolvedValueOnce({ limits: {} }).mockResolvedValueOnce({ limits: limits("codex") });
    const controller: { current: AgentLimitsController | null } = { current: null };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.loaded).toBe(true));

    await act(async () => {
      controller.current?.refresh("codex", true);
    });
    await waitFor(() => expect(loadAgentLimitsMock).toHaveBeenCalledTimes(2));

    act(() => {
      controller.current?.refresh("codex", true);
    });

    expect(loadAgentLimitsMock).toHaveBeenCalledTimes(2);
  });

  it("reports initial load failures as toast errors", async () => {
    loadAgentLimitsMock.mockRejectedValueOnce(new Error("limits unavailable"));
    const toast = vi.fn(() => "toast-1");
    const controller: { current: AgentLimitsController | null } = { current: null };

    render(
      <Harness
        toast={toast}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.loaded).toBe(true));
    expect(toast).toHaveBeenCalledWith({ message: "limits unavailable", severity: "error", duration: 3000 });
  });

  it("stores per-agent refresh failures without a toast", async () => {
    loadAgentLimitsMock.mockResolvedValueOnce({ limits: {} }).mockRejectedValueOnce(new Error("refresh failed"));
    const toast = vi.fn(() => "toast-1");
    const controller: { current: AgentLimitsController | null } = { current: null };

    render(
      <Harness
        toast={toast}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.loaded).toBe(true));

    await act(async () => {
      controller.current?.refresh("codex", true);
    });

    await waitFor(() => expect(controller.current?.refreshErrors.codex).toBe("refresh failed"));
    expect(controller.current?.refreshing.codex).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
