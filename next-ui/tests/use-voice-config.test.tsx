import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { type VoiceConfigController, useVoiceConfig } from "../src/components/workspace/hooks/use-voice-config";
import { loadVoiceConfig, type VoiceConfigSnapshot } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", () => ({
  loadVoiceConfig: vi.fn(),
}));

const loadVoiceConfigMock = vi.mocked(loadVoiceConfig);

function config(configured: boolean): VoiceConfigSnapshot {
  return { providers: { openai: { envVar: "OPENAI_API_KEY", configured } } };
}

function Harness({
  toast,
  capture,
}: {
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (controller: VoiceConfigController) => void;
}) {
  const controller = useVoiceConfig({ toast });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useVoiceConfig", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads voice config on mount", async () => {
    const snapshot = config(true);
    loadVoiceConfigMock.mockResolvedValueOnce(snapshot);
    const controller: { current: VoiceConfigController | null } = { current: null };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.config).toEqual(snapshot));
    expect(loadVoiceConfigMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes voice config on demand", async () => {
    loadVoiceConfigMock.mockResolvedValueOnce(config(false)).mockResolvedValueOnce(config(true));
    const controller: { current: VoiceConfigController | null } = { current: null };

    render(
      <Harness
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.config).toEqual(config(false)));

    await act(async () => {
      controller.current?.refresh();
    });

    await waitFor(() => expect(controller.current?.config).toEqual(config(true)));
  });

  it("clears config and reports load errors", async () => {
    loadVoiceConfigMock.mockResolvedValueOnce(config(true)).mockRejectedValueOnce(new Error("voice unavailable"));
    const toast = vi.fn(() => "toast-1");
    const controller: { current: VoiceConfigController | null } = { current: null };

    render(
      <Harness
        toast={toast}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.config).toEqual(config(true)));

    await act(async () => {
      controller.current?.refresh();
    });

    await waitFor(() => expect(controller.current?.config).toEqual({ providers: {} }));
    expect(toast).toHaveBeenCalledWith({ message: "voice unavailable", severity: "error", duration: 3000 });
  });
});
