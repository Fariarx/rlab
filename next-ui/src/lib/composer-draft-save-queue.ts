import type { ComposerDraft } from "../domain/agent-types";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ComposerDraftSaveQueueOptions {
  readonly delayMs: number;
  readonly saveDraft: (conversationId: string, draft: ComposerDraft) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (timer: TimerHandle) => void;
}

export class ComposerDraftSaveQueue {
  private readonly delayMs: number;
  private readonly saveDraft: (conversationId: string, draft: ComposerDraft) => void;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;
  private readonly timers = new Map<string, TimerHandle>();
  private readonly drafts = new Map<string, ComposerDraft>();

  constructor(options: ComposerDraftSaveQueueOptions) {
    this.delayMs = options.delayMs;
    this.saveDraft = options.saveDraft;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  schedule(conversationId: string, draft: ComposerDraft): void {
    if (isEmptyComposerDraft(draft)) {
      this.discard(conversationId);
      this.saveDraft(conversationId, cloneComposerDraft(draft));
      return;
    }
    this.drafts.set(conversationId, cloneComposerDraft(draft));
    this.cancelTimer(conversationId);
    this.timers.set(conversationId, this.setTimer(() => this.flush(conversationId), this.delayMs));
  }

  flush(conversationId: string): void {
    const draft = this.drafts.get(conversationId);
    if (!draft) {
      this.cancelTimer(conversationId);
      return;
    }
    this.cancelTimer(conversationId);
    this.drafts.delete(conversationId);
    this.saveDraft(conversationId, draft);
  }

  flushAll(): void {
    for (const conversationId of Array.from(this.drafts.keys())) {
      this.flush(conversationId);
    }
  }

  discard(conversationId: string): void {
    this.cancelTimer(conversationId);
    this.drafts.delete(conversationId);
  }

  private cancelTimer(conversationId: string): void {
    const timer = this.timers.get(conversationId);
    if (!timer) {
      return;
    }
    this.clearTimer(timer);
    this.timers.delete(conversationId);
  }
}

function cloneComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.text.trim().length === 0 && draft.attachments.length === 0;
}
