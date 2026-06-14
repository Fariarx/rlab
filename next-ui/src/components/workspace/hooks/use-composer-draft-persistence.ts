import { useCallback, useEffect, useRef } from "react";
import type { ComposerDraft } from "../../agent";
import { ComposerDraftSaveQueue } from "../../../lib/composer-draft-save-queue";

const COMPOSER_DRAFT_SAVE_DELAY_MS = 350;
const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "", attachments: [] };

export interface UseComposerDraftPersistenceOptions {
  readonly updateComposerDraft: (conversationId: string, draft: ComposerDraft) => void;
  readonly delayMs?: number;
}

export interface ComposerDraftPersistence {
  readonly scheduleDraft: (conversationId: string, draft: ComposerDraft) => void;
  readonly discardDraft: (conversationId: string) => void;
  readonly clearDraft: (conversationId: string) => void;
}

export function useComposerDraftPersistence({ updateComposerDraft, delayMs = COMPOSER_DRAFT_SAVE_DELAY_MS }: UseComposerDraftPersistenceOptions): ComposerDraftPersistence {
  const updateComposerDraftRef = useRef(updateComposerDraft);
  const queueRef = useRef<ComposerDraftSaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new ComposerDraftSaveQueue({
      delayMs,
      saveDraft: (conversationId, draft) => updateComposerDraftRef.current(conversationId, draft),
    });
  }
  const queue = queueRef.current;

  useEffect(() => {
    updateComposerDraftRef.current = updateComposerDraft;
  }, [updateComposerDraft]);

  useEffect(() => {
    return () => {
      queue.flushAll();
    };
  }, [queue]);

  const scheduleDraft = useCallback((conversationId: string, draft: ComposerDraft) => queue.schedule(conversationId, draft), [queue]);
  const discardDraft = useCallback((conversationId: string) => queue.discard(conversationId), [queue]);
  const clearDraft = useCallback(
    (conversationId: string) => {
      queue.discard(conversationId);
      updateComposerDraftRef.current(conversationId, EMPTY_COMPOSER_DRAFT);
    },
    [queue],
  );

  return { scheduleDraft, discardDraft, clearDraft };
}
