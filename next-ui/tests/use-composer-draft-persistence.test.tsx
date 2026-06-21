import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraft } from "../src/components/agent";
import { useComposerDraftPersistence, type ComposerDraftPersistence } from "../src/components/workspace/hooks/use-composer-draft-persistence";

const emptyDraft: ComposerDraft = { text: "", attachments: [] };

function draft(text: string): ComposerDraft {
  return { text, attachments: [] };
}

function Harness({
  updateComposerDraft,
  capture,
}: {
  readonly updateComposerDraft: (conversationId: string, draft: ComposerDraft) => void;
  readonly capture: (persistence: ComposerDraftPersistence) => void;
}) {
  const persistence = useComposerDraftPersistence({ updateComposerDraft, delayMs: 50 });
  useEffect(() => {
    capture(persistence);
  }, [capture, persistence]);
  return null;
}

describe("useComposerDraftPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces draft saves per conversation", () => {
    const updateComposerDraft = vi.fn();
    const captured: { current: ComposerDraftPersistence | null } = { current: null };

    render(
      <Harness
        updateComposerDraft={updateComposerDraft}
        capture={(persistence) => {
          captured.current = persistence;
        }}
      />,
    );

    act(() => {
      captured.current?.scheduleDraft("chat-1", draft("first"));
      captured.current?.scheduleDraft("chat-1", draft("second"));
      vi.advanceTimersByTime(49);
    });
    expect(updateComposerDraft).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(updateComposerDraft).toHaveBeenCalledWith("chat-1", draft("second"));
  });

  it("clears a draft immediately and discards pending saves", () => {
    const updateComposerDraft = vi.fn();
    const captured: { current: ComposerDraftPersistence | null } = { current: null };

    render(
      <Harness
        updateComposerDraft={updateComposerDraft}
        capture={(persistence) => {
          captured.current = persistence;
        }}
      />,
    );

    act(() => {
      captured.current?.scheduleDraft("chat-1", draft("pending"));
      captured.current?.clearDraft("chat-1");
      vi.advanceTimersByTime(50);
    });

    expect(updateComposerDraft).toHaveBeenCalledTimes(1);
    expect(updateComposerDraft).toHaveBeenCalledWith("chat-1", emptyDraft);
  });

  it("saves scheduled empty drafts immediately and discards pending text", () => {
    const updateComposerDraft = vi.fn();
    const captured: { current: ComposerDraftPersistence | null } = { current: null };

    render(
      <Harness
        updateComposerDraft={updateComposerDraft}
        capture={(persistence) => {
          captured.current = persistence;
        }}
      />,
    );

    act(() => {
      captured.current?.scheduleDraft("chat-1", draft("pending"));
      captured.current?.scheduleDraft("chat-1", emptyDraft);
      vi.advanceTimersByTime(50);
    });

    expect(updateComposerDraft).toHaveBeenCalledTimes(1);
    expect(updateComposerDraft).toHaveBeenCalledWith("chat-1", emptyDraft);
  });

  it("flushes pending drafts on unmount", () => {
    const updateComposerDraft = vi.fn();
    const captured: { current: ComposerDraftPersistence | null } = { current: null };
    const mounted = render(
      <Harness
        updateComposerDraft={updateComposerDraft}
        capture={(persistence) => {
          captured.current = persistence;
        }}
      />,
    );

    act(() => captured.current?.scheduleDraft("chat-1", draft("pending")));
    mounted.unmount();

    expect(updateComposerDraft).toHaveBeenCalledWith("chat-1", draft("pending"));
  });
});
