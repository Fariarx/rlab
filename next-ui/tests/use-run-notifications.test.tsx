import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import { DEFAULT_PROFILE } from "../src/lib/agent-catalog";
import type { ConversationSummary } from "../src/domain/agent-types";
import type { ToastOptions } from "../src/components/ui";
import { type RunNotificationController, useRunNotifications } from "../src/components/workspace/hooks/use-run-notifications";

const t: I18nApi["t"] = (key, params) => (typeof params?.title === "string" ? `${key}:${params.title}` : key);

function conversation(id: string, status: ConversationSummary["status"], title = id): ConversationSummary {
  return {
    id,
    title,
    status,
    snippet: "",
    time: "now",
    agent: DEFAULT_PROFILE.agent,
    profile: DEFAULT_PROFILE,
  };
}

function Harness({
  conversations,
  selectedId,
  toast,
  capture,
}: {
  readonly conversations: readonly ConversationSummary[];
  readonly selectedId: string;
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (controller: RunNotificationController) => void;
}) {
  const controller = useRunNotifications({
    conversations,
    selectedId,
    desktopNotifications: false,
    t,
    toast,
  });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useRunNotifications", () => {
  it("notifies when a marked background run completes", () => {
    const toast = vi.fn(() => "toast-1");
    const controller: { current: RunNotificationController | null } = { current: null };
    const capture = (next: RunNotificationController) => {
      controller.current = next;
    };
    const { rerender } = render(
      <Harness conversations={[conversation("chat-1", "running", "Build")]} selectedId="chat-2" toast={toast} capture={capture} />,
    );

    controller.current?.mark("chat-1");
    rerender(<Harness conversations={[conversation("chat-1", "done", "Build")]} selectedId="chat-2" toast={toast} capture={capture} />);

    expect(toast).toHaveBeenCalledWith({ message: "runCompletedToast:Build", severity: "success", duration: 3500 });
  });

  it("does not show done noise for the foreground conversation", () => {
    const toast = vi.fn(() => "toast-1");
    const controller: { current: RunNotificationController | null } = { current: null };
    const capture = (next: RunNotificationController) => {
      controller.current = next;
    };
    const { rerender } = render(
      <Harness conversations={[conversation("chat-1", "running", "Build")]} selectedId="chat-1" toast={toast} capture={capture} />,
    );

    controller.current?.mark("chat-1");
    rerender(<Harness conversations={[conversation("chat-1", "done", "Build")]} selectedId="chat-1" toast={toast} capture={capture} />);

    expect(toast).not.toHaveBeenCalled();
  });

  it("keeps waiting runs marked so final completion can notify later", () => {
    const toast = vi.fn(() => "toast-1");
    const controller: { current: RunNotificationController | null } = { current: null };
    const capture = (next: RunNotificationController) => {
      controller.current = next;
    };
    const { rerender } = render(
      <Harness conversations={[conversation("chat-1", "running", "Deploy")]} selectedId="chat-2" toast={toast} capture={capture} />,
    );

    controller.current?.mark("chat-1");
    rerender(<Harness conversations={[conversation("chat-1", "waiting", "Deploy")]} selectedId="chat-2" toast={toast} capture={capture} />);
    rerender(<Harness conversations={[conversation("chat-1", "done", "Deploy")]} selectedId="chat-2" toast={toast} capture={capture} />);

    expect(toast).toHaveBeenNthCalledWith(1, { message: "runNeedsInputToast:Deploy", severity: "warning", duration: 3500 });
    expect(toast).toHaveBeenNthCalledWith(2, { message: "runCompletedToast:Deploy", severity: "success", duration: 3500 });
  });
});
