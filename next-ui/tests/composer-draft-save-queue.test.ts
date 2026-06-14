import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraft } from "../src/domain/agent-types";
import { ComposerDraftSaveQueue } from "../src/lib/composer-draft-save-queue";

function draft(text: string): ComposerDraft {
  return {
    text,
    attachments: [
      {
        id: "att-1",
        name: "note.txt",
        type: "text/plain",
        content: text,
        size: text.length,
        lastModified: 1,
      },
    ],
  };
}

describe("ComposerDraftSaveQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces draft saves per conversation", () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn();
    const queue = new ComposerDraftSaveQueue({ delayMs: 350, saveDraft });

    queue.schedule("chat-1", draft("first"));
    queue.schedule("chat-1", draft("second"));
    vi.advanceTimersByTime(349);

    expect(saveDraft).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith("chat-1", draft("second"));
  });

  it("clones scheduled drafts before saving them later", () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn();
    const queue = new ComposerDraftSaveQueue({ delayMs: 10, saveDraft });
    const sourceAttachment = {
      id: "att-1",
      name: "note.txt",
      type: "text/plain",
      content: "stable",
      size: 6,
      lastModified: 1,
    };
    const source: ComposerDraft = { text: "stable", attachments: [sourceAttachment] };

    queue.schedule("chat-1", source);
    sourceAttachment.name = "mutated.txt";
    vi.advanceTimersByTime(10);

    expect(saveDraft).toHaveBeenCalledWith("chat-1", draft("stable"));
  });

  it("flushes all pending drafts immediately", () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn();
    const queue = new ComposerDraftSaveQueue({ delayMs: 350, saveDraft });

    queue.schedule("chat-1", draft("one"));
    queue.schedule("chat-2", draft("two"));
    queue.flushAll();

    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenCalledWith("chat-1", draft("one"));
    expect(saveDraft).toHaveBeenCalledWith("chat-2", draft("two"));
  });

  it("discards pending drafts without saving them", () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn();
    const queue = new ComposerDraftSaveQueue({ delayMs: 10, saveDraft });

    queue.schedule("chat-1", draft("removed"));
    queue.discard("chat-1");
    vi.advanceTimersByTime(10);
    queue.flushAll();

    expect(saveDraft).not.toHaveBeenCalled();
  });
});
