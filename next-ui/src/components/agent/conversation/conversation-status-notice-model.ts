import type { ChatMessage, ConversationSummary } from "../core/types";

function lastAgentMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "agent") {
      return message;
    }
  }
  return undefined;
}

function hasVisibleErrorStatus(message: ChatMessage | undefined): boolean {
  return Boolean(message?.blocks?.some((block) => block.kind === "status" && block.level === "error"));
}

export function appendConversationErrorNotice(
  conversation: ConversationSummary | null | undefined,
  messages: readonly ChatMessage[],
  text: string,
): readonly ChatMessage[] {
  if (conversation?.status !== "error" || hasVisibleErrorStatus(lastAgentMessage(messages))) {
    return messages;
  }
  return [
    ...messages,
    {
      id: `${conversation.id}:error-status-notice`,
      role: "agent",
      time: conversation.time,
      blocks: [{ kind: "status", level: "error", text }],
    },
  ];
}
