import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { type WakeupsController, useWakeups } from "../src/components/workspace/hooks/use-wakeups";
import { deleteWakeup, loadWakeups, type WakeupSummary } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", () => ({
  deleteWakeup: vi.fn(),
  loadWakeups: vi.fn(),
}));

const deleteWakeupMock = vi.mocked(deleteWakeup);
const loadWakeupsMock = vi.mocked(loadWakeups);

function wakeup(id: string, conversationId: string): WakeupSummary {
  return {
    id,
    conversationId,
    agent: "codex",
    prompt: `prompt-${id}`,
    trigger: { type: "time", fireAtMs: 1000 },
  };
}

function Harness({
  selectedConversationId,
  selectedStatus = "running",
  messageCount = 1,
  toast,
  capture,
}: {
  readonly selectedConversationId: string | undefined;
  readonly selectedStatus?: string;
  readonly messageCount?: number;
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (controller: WakeupsController) => void;
}) {
  const controller = useWakeups({ selectedConversationId, selectedStatus, messageCount, toast });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useWakeups", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads wakeups and derives selected wakeups and conversation ids", async () => {
    const wakeups = [wakeup("w1", "chat-1"), wakeup("w2", "chat-2")];
    loadWakeupsMock.mockResolvedValueOnce(wakeups);
    const controller: { current: WakeupsController | null } = { current: null };

    render(
      <Harness
        selectedConversationId="chat-1"
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await waitFor(() => expect(controller.current?.wakeups).toEqual(wakeups));
    expect(controller.current?.selectedWakeups).toEqual([wakeups[0]]);
    expect(controller.current?.wakeupConversationIds).toEqual(new Set(["chat-1", "chat-2"]));
  });

  it("does not refetch wakeups when only the selected message count changes", async () => {
    const wakeups = [wakeup("w1", "chat-1")];
    loadWakeupsMock.mockResolvedValue(wakeups);
    const controller: { current: WakeupsController | null } = { current: null };

    const view = render(
      <Harness
        selectedConversationId="chat-1"
        messageCount={1}
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.wakeups).toEqual(wakeups));
    expect(loadWakeupsMock).toHaveBeenCalledTimes(1);

    view.rerender(
      <Harness
        selectedConversationId="chat-1"
        messageCount={2}
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadWakeupsMock).toHaveBeenCalledTimes(1);
  });

  it("removes a wakeup optimistically", async () => {
    const wakeups = [wakeup("w1", "chat-1"), wakeup("w2", "chat-1")];
    loadWakeupsMock.mockResolvedValueOnce(wakeups);
    deleteWakeupMock.mockResolvedValueOnce();
    const controller: { current: WakeupsController | null } = { current: null };

    render(
      <Harness
        selectedConversationId="chat-1"
        toast={vi.fn(() => "toast-1")}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.selectedWakeups).toEqual(wakeups));

    act(() => {
      controller.current?.removeWakeup("w1");
    });

    expect(deleteWakeupMock).toHaveBeenCalledWith("chat-1", "w1");
    await waitFor(() => expect(controller.current?.selectedWakeups).toEqual([wakeups[1]]));
  });

  it("refreshes wakeups and reports an error when removal fails", async () => {
    const initialWakeups = [wakeup("w1", "chat-1")];
    const refreshedWakeups = [wakeup("w1", "chat-1"), wakeup("w2", "chat-2")];
    loadWakeupsMock.mockResolvedValueOnce(initialWakeups).mockResolvedValueOnce(refreshedWakeups);
    deleteWakeupMock.mockRejectedValueOnce(new Error("delete failed"));
    const toast = vi.fn(() => "toast-1");
    const controller: { current: WakeupsController | null } = { current: null };

    render(
      <Harness
        selectedConversationId="chat-1"
        toast={toast}
        capture={(next) => {
          controller.current = next;
        }}
      />,
    );
    await waitFor(() => expect(controller.current?.wakeups).toEqual(initialWakeups));

    act(() => {
      controller.current?.removeWakeup("w1");
    });

    await waitFor(() => expect(controller.current?.wakeups).toEqual(refreshedWakeups));
    expect(toast).toHaveBeenCalledWith({ message: "delete failed", severity: "error", duration: 3000 });
  });
});
