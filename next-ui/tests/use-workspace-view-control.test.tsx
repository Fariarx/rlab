import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationView } from "../src/components/agent";
import { useWorkspaceViewControl } from "../src/components/workspace/hooks/use-workspace-view-control";

function Harness({
  selectedConversationId = "chat-1",
  selectedView,
  terminalEnabled = true,
  previewEnabled = true,
  view = "chat",
  setView,
  persistConversationView,
  capture,
}: {
  readonly selectedConversationId?: string | null;
  readonly selectedView?: ConversationView;
  readonly terminalEnabled?: boolean;
  readonly previewEnabled?: boolean;
  readonly view?: ConversationView;
  readonly setView: (view: ConversationView) => void;
  readonly persistConversationView: (conversationId: string, view: ConversationView) => void;
  readonly capture: (showView: (view: ConversationView) => void) => void;
}) {
  const showView = useWorkspaceViewControl({
    selectedConversationId: selectedConversationId ?? undefined,
    selectedView,
    terminalEnabled,
    previewEnabled,
    view,
    setView,
    persistConversationView,
  });

  useEffect(() => {
    capture(showView);
  }, [capture, showView]);

  return null;
}

describe("useWorkspaceViewControl", () => {
  it("normalizes the selected conversation view into local page state", () => {
    const setView = vi.fn();

    render(
      <Harness
        selectedView="preview"
        setView={setView}
        persistConversationView={vi.fn()}
        capture={vi.fn()}
      />,
    );

    expect(setView).toHaveBeenCalledWith("preview");
  });

  it("persists explicit view changes for the selected conversation", async () => {
    const setView = vi.fn();
    const persistConversationView = vi.fn();
    const captured: { current: ((view: ConversationView) => void) | null } = { current: null };

    render(
      <Harness
        setView={setView}
        persistConversationView={persistConversationView}
        capture={(showView) => {
          captured.current = showView;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.("git");

    expect(setView).toHaveBeenCalledWith("git");
    expect(persistConversationView).toHaveBeenCalledWith("chat-1", "git");
  });

  it("does not persist view changes when no conversation is selected", async () => {
    const persistConversationView = vi.fn();
    const captured: { current: ((view: ConversationView) => void) | null } = { current: null };

    render(
      <Harness
        selectedConversationId={null}
        setView={vi.fn()}
        persistConversationView={persistConversationView}
        capture={(showView) => {
          captured.current = showView;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.("resources");

    expect(persistConversationView).not.toHaveBeenCalled();
  });

  it("leaves terminal when terminal support is disabled", () => {
    const setView = vi.fn();
    const persistConversationView = vi.fn();

    render(
      <Harness
        selectedView="terminal"
        terminalEnabled={false}
        view="terminal"
        setView={setView}
        persistConversationView={persistConversationView}
        capture={vi.fn()}
      />,
    );

    expect(setView).toHaveBeenCalledWith("chat");
    expect(persistConversationView).toHaveBeenCalledWith("chat-1", "chat");
  });

  it("leaves preview when the Preview tool is disabled", () => {
    const setView = vi.fn();
    const persistConversationView = vi.fn();

    render(
      <Harness
        selectedView="preview"
        previewEnabled={false}
        view="preview"
        setView={setView}
        persistConversationView={persistConversationView}
        capture={vi.fn()}
      />,
    );

    expect(setView).toHaveBeenCalledWith("chat");
    expect(persistConversationView).toHaveBeenCalledWith("chat-1", "chat");
  });
});
