import { useCallback, useMemo, useRef } from "react";
import type { ReviewCommentAnchor, ReviewCommentEntry } from "../../agent";
import type { DiffCommentApi } from "../git/GitPanel";

export interface UseReviewCommentsOptions {
  readonly comments: readonly ReviewCommentEntry[];
  readonly setComments: (value: readonly ReviewCommentEntry[] | ((current: readonly ReviewCommentEntry[]) => readonly ReviewCommentEntry[])) => void;
  readonly selectedConversationId?: string;
  readonly addReviewComments: (conversationId: string, comments: readonly ReviewCommentEntry[]) => void;
  readonly showChat: () => void;
}

export interface UseReviewCommentsResult {
  readonly review: DiffCommentApi;
  readonly sendReviewComments: () => void;
}

export function useReviewComments({ comments, setComments, selectedConversationId, addReviewComments, showChat }: UseReviewCommentsOptions): UseReviewCommentsResult {
  const sequenceRef = useRef(0);

  const review = useMemo<DiffCommentApi>(
    () => ({
      comments,
      onAddComment: (file, anchor: ReviewCommentAnchor, body) =>
        setComments((current) => [...current, { id: `rc-${++sequenceRef.current}`, file, ...anchor, body }]),
      onUpdateComment: (id, body) => setComments((current) => current.map((comment) => (comment.id === id ? { ...comment, body } : comment))),
      onDeleteComment: (id) => setComments((current) => current.filter((comment) => comment.id !== id)),
    }),
    [comments, setComments],
  );

  const sendReviewComments = useCallback(() => {
    if (!selectedConversationId || comments.length === 0) {
      return;
    }
    addReviewComments(selectedConversationId, comments);
    setComments([]);
    showChat();
  }, [addReviewComments, comments, selectedConversationId, setComments, showChat]);

  return { review, sendReviewComments };
}
