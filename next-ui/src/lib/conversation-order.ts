import type { ConversationSummary } from "../domain/agent-types";
import { normalizeConversationUpdatedAtMs } from "./time-format";

export function sortConversationsNewestFirst<T extends ConversationSummary>(conversations: readonly T[]): T[] {
  const now = new Date();
  return conversations
    .map((conversation, index) => ({
      conversation,
      index,
      updatedAtMs: normalizeConversationUpdatedAtMs(conversation.time, conversation.updatedAtMs, now),
    }))
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.index - right.index)
    .map((entry) => entry.conversation);
}
