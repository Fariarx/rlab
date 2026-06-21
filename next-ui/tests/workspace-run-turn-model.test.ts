import { describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/components/agent";
import { prepareWorkspaceRunTurn } from "../src/components/workspace/models/workspace-run-turn-model";

function conversation(patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "chat-1",
    title: "New chat",
    snippet: "Empty",
    time: "11:00",
    status: "idle",
    agent: "codex",
    profile: { agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" },
    ...patch,
  };
}

function userMessage(id: string, text: string): ChatMessage {
  return { id, role: "user", text, time: "12:00", createdAtMs: 120_000 };
}

function agentMessage(id: string, text: string): ChatMessage {
  return { id, role: "agent", time: "12:01", blocks: [{ kind: "text", text }] };
}

describe("prepareWorkspaceRunTurn", () => {
  it("builds the running conversation patch and agent placeholder", () => {
    const prepared = prepareWorkspaceRunTurn({
      conversation: conversation({ usage: { totalTokens: 100, contextTokens: 75 } }),
      thread: [userMessage("u1", "Build the feature")],
      userMessage: userMessage("u1", "Build the feature"),
      runId: "run-1",
      agentMessageId: "a1",
      agentMessageTime: "12:02",
      agentStartedAtMs: 1000,
      options: { initialContextTokens: 0 },
    });

    expect(prepared.conversationPatch).toEqual({
      activeRunId: "run-1",
      status: "running",
      snippet: "Build the feature",
      time: "12:00",
      updatedAtMs: 120_000,
      unread: false,
      costUsd: undefined,
      usage: { totalTokens: 100, contextTokens: 0 },
      title: "Build the feature",
    });
    expect(prepared.agentMessage).toEqual({
      id: "a1",
      role: "agent",
      time: "12:02",
      startedAtMs: 1000,
      profile: { agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" },
      blocks: [],
    });
  });

  it("uses prompt overrides before resume or transcript prompts", () => {
    const prepared = prepareWorkspaceRunTurn({
      conversation: conversation({ agentSessions: { codex: "session-1" } }),
      thread: [userMessage("u1", "First"), agentMessage("a1", "Answer"), userMessage("u2", "Second")],
      userMessage: userMessage("u2", "Second"),
      runId: "run-1",
      agentMessageId: "a1",
      agentMessageTime: "12:02",
      agentStartedAtMs: 1000,
      options: { promptOverride: "/compact" },
    });

    expect(prepared.resume).toBe("session-1");
    expect(prepared.prompt).toBe("/compact");
  });

  it("builds transcript prompts only for fresh agent sessions", () => {
    const thread = [userMessage("u1", "First"), agentMessage("a1", "Answer"), userMessage("u2", "Second")];
    const fresh = prepareWorkspaceRunTurn({
      conversation: conversation(),
      thread,
      userMessage: thread[2] as ChatMessage,
      runId: "run-1",
      agentMessageId: "a2",
      agentMessageTime: "12:03",
      agentStartedAtMs: 1000,
    });
    const resumed = prepareWorkspaceRunTurn({
      conversation: conversation({ agentSessions: { codex: "session-1" } }),
      thread,
      userMessage: thread[2] as ChatMessage,
      runId: "run-2",
      agentMessageId: "a3",
      agentMessageTime: "12:04",
      agentStartedAtMs: 1001,
    });

    expect(fresh.prompt).toContain("User: First");
    expect(fresh.prompt).toContain("Assistant: Answer");
    expect(fresh.prompt).toContain("User: Second");
    expect(resumed.prompt).toBe("Second");
  });
});
