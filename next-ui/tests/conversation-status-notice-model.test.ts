import { describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/components/agent";
import { appendConversationErrorNotice } from "../src/components/agent/conversation/conversation-status-notice-model";

const conversation: ConversationSummary = {
  id: "chat-error",
  title: "Broken chat",
  snippet: "",
  time: "12:00",
  status: "error",
  agent: "codex",
};

describe("conversation-status-notice-model", () => {
  it("adds a visible error status for errored conversations without an error block", () => {
    const messages: readonly ChatMessage[] = [{ id: "a1", role: "agent", blocks: [{ kind: "text", text: "partial answer" }] }];

    expect(appendConversationErrorNotice(conversation, messages, "Run failed")).toEqual([
      ...messages,
      {
        id: "chat-error:error-status-notice",
        role: "agent",
        time: "12:00",
        blocks: [{ kind: "status", level: "error", text: "Run failed" }],
      },
    ]);
  });

  it("does not duplicate an existing visible error status", () => {
    const messages: readonly ChatMessage[] = [{ id: "a1", role: "agent", blocks: [{ kind: "status", level: "error", text: "Already failed" }] }];

    expect(appendConversationErrorNotice(conversation, messages, "Run failed")).toBe(messages);
  });

  it("does not add notices to non-error conversations", () => {
    const messages: readonly ChatMessage[] = [{ id: "a1", role: "agent", blocks: [{ kind: "text", text: "done" }] }];

    expect(appendConversationErrorNotice({ ...conversation, status: "idle" }, messages, "Run failed")).toBe(messages);
  });
});
