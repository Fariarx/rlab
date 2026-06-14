import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewCommentEntry } from "../src/components/agent";
import { useReviewComments, type UseReviewCommentsResult } from "../src/components/workspace/hooks/use-review-comments";

function Harness({
  initialComments = [],
  selectedConversationId = "chat-1",
  addReviewComments,
  showChat,
  capture,
}: {
  readonly initialComments?: readonly ReviewCommentEntry[];
  readonly selectedConversationId?: string | null;
  readonly addReviewComments: (conversationId: string, comments: readonly ReviewCommentEntry[]) => void;
  readonly showChat: () => void;
  readonly capture: (result: UseReviewCommentsResult & { readonly comments: readonly ReviewCommentEntry[] }) => void;
}) {
  const [comments, setComments] = useState<readonly ReviewCommentEntry[]>(initialComments);
  const result = useReviewComments({
    comments,
    setComments,
    selectedConversationId: selectedConversationId ?? undefined,
    addReviewComments,
    showChat,
  });

  useEffect(() => {
    capture({ ...result, comments });
  }, [capture, comments, result]);

  return null;
}

describe("useReviewComments", () => {
  it("adds, updates, and deletes pending review comments", async () => {
    const captured: { current: (UseReviewCommentsResult & { readonly comments: readonly ReviewCommentEntry[] }) | null } = { current: null };

    render(
      <Harness
        addReviewComments={vi.fn()}
        showChat={vi.fn()}
        capture={(result) => {
          captured.current = result;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => captured.current?.review.onAddComment("src/file.ts", 12, "+line", "first"));
    await waitFor(() => expect(captured.current?.comments).toHaveLength(1));
    expect(captured.current?.comments[0]).toEqual({ id: "rc-1", file: "src/file.ts", line: 12, lineText: "+line", body: "first" });

    act(() => captured.current?.review.onUpdateComment("rc-1", "updated"));
    await waitFor(() => expect(captured.current?.comments[0]?.body).toBe("updated"));

    act(() => captured.current?.review.onDeleteComment("rc-1"));
    await waitFor(() => expect(captured.current?.comments).toEqual([]));
  });

  it("sends pending comments to the selected conversation and clears them", async () => {
    const addReviewComments = vi.fn();
    const showChat = vi.fn();
    const comments: readonly ReviewCommentEntry[] = [{ id: "rc-1", file: "src/file.ts", line: 4, lineText: "-old", body: "Needs update" }];
    const captured: { current: (UseReviewCommentsResult & { readonly comments: readonly ReviewCommentEntry[] }) | null } = { current: null };

    render(
      <Harness
        initialComments={comments}
        addReviewComments={addReviewComments}
        showChat={showChat}
        capture={(result) => {
          captured.current = result;
        }}
      />,
    );

    await waitFor(() => expect(captured.current?.comments).toHaveLength(1));
    act(() => captured.current?.sendReviewComments());

    expect(addReviewComments).toHaveBeenCalledWith("chat-1", comments);
    expect(showChat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(captured.current?.comments).toEqual([]));
  });

  it("does not send without a selected conversation or without comments", async () => {
    const addReviewComments = vi.fn();
    const showChat = vi.fn();
    const captured: { current: (UseReviewCommentsResult & { readonly comments: readonly ReviewCommentEntry[] }) | null } = { current: null };

    const { unmount } = render(
      <Harness
        selectedConversationId={null}
        initialComments={[{ id: "rc-1", file: "src/file.ts", line: 4, lineText: "-old", body: "Needs update" }]}
        addReviewComments={addReviewComments}
        showChat={showChat}
        capture={(result) => {
          captured.current = result;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => captured.current?.sendReviewComments());
    expect(addReviewComments).not.toHaveBeenCalled();
    expect(showChat).not.toHaveBeenCalled();

    unmount();
    captured.current = null;

    render(
      <Harness
        initialComments={[]}
        addReviewComments={addReviewComments}
        showChat={showChat}
        capture={(result) => {
          captured.current = result;
        }}
      />,
    );
    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => captured.current?.sendReviewComments());
    expect(addReviewComments).not.toHaveBeenCalled();
    expect(showChat).not.toHaveBeenCalled();
  });
});
