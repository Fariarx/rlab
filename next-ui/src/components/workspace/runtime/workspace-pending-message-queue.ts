import { makeAutoObservable } from "mobx";
import type { ChatMessage } from "../../agent";

/**
 * Per-conversation FIFO of user turns waiting for the active run to settle.
 *
 * Observable so the bottom-of-thread queued list re-renders as turns are added,
 * cancelled, or drained. Queued turns are deliberately *not* written into the
 * thread until they actually dispatch (see `dispatchUserTurn`) — they live here
 * as a distinct, cancellable list instead of masquerading as sent messages.
 */
export class WorkspacePendingMessageQueue {
  private readonly messages = new Map<string, ChatMessage[]>();

  constructor() {
    makeAutoObservable(this);
  }

  enqueue(conversationId: string, message: ChatMessage): void {
    const queue = this.messages.get(conversationId) ?? [];
    queue.push(message);
    this.messages.set(conversationId, queue);
  }

  count(conversationId: string): number {
    return this.messages.get(conversationId)?.length ?? 0;
  }

  /** The queued turns for a conversation, in send order (empty when none). */
  list(conversationId: string): readonly ChatMessage[] {
    return this.messages.get(conversationId) ?? [];
  }

  forget(conversationId: string): void {
    this.messages.delete(conversationId);
  }

  has(conversationId: string): boolean {
    return this.count(conversationId) > 0;
  }

  /** Drop a single queued turn by id (user cancelled it before it ran). */
  remove(conversationId: string, messageId: string): void {
    const queue = this.messages.get(conversationId);
    if (!queue) {
      return;
    }
    const next = queue.filter((message) => message.id !== messageId);
    if (next.length === 0) {
      this.messages.delete(conversationId);
    } else {
      this.messages.set(conversationId, next);
    }
  }

  takeNext(conversationId: string): ChatMessage | null {
    const queue = this.messages.get(conversationId);
    if (!queue || queue.length === 0) {
      return null;
    }
    const next = queue.shift() ?? null;
    if (queue.length === 0) {
      this.messages.delete(conversationId);
    }
    return next;
  }
}
