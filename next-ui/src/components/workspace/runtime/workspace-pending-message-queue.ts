import type { ChatMessage } from "../../agent";

export class WorkspacePendingMessageQueue {
  private readonly messages = new Map<string, ChatMessage[]>();

  enqueue(conversationId: string, message: ChatMessage): void {
    const queue = this.messages.get(conversationId) ?? [];
    queue.push(message);
    this.messages.set(conversationId, queue);
  }

  count(conversationId: string): number {
    return this.messages.get(conversationId)?.length ?? 0;
  }

  forget(conversationId: string): void {
    this.messages.delete(conversationId);
  }

  has(conversationId: string): boolean {
    return this.count(conversationId) > 0;
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
