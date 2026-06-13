import type { AgentBlock, ChatMessage } from "../domain/agent-types";

export function previewSnippet(text: string, max = 60): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function agentBlockPreviewText(block: AgentBlock): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "code":
      return block.code;
    default:
      return "";
  }
}

export function messagePreviewText(message: ChatMessage): string {
  if (message.role === "user") {
    return (message.text ?? "").trim();
  }
  const blocks = message.blocks ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const text = agentBlockPreviewText(blocks[index]).trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

export function conversationPreviewText(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messagePreviewText(messages[index]);
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

export function conversationPreviewSnippet(messages: readonly ChatMessage[], max = 60): string {
  return previewSnippet(conversationPreviewText(messages), max);
}
