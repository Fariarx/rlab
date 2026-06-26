import { describe, expect, it } from "vitest";
import type { AgentBlock, ChatMessage, ConversationSummary } from "../src/components/agent";
import { applyWorkspaceAgentBlocks } from "../src/components/workspace/models/workspace-agent-block-update-model";
import { patchActiveRunUpdate } from "../src/components/workspace/models/workspace-run-state";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";

function conversation(patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "chat-1",
    title: "Chat",
    snippet: "Initial",
    time: "11:00",
    status: "running",
    agent: "codex",
    ...patch,
  };
}

function userMessage(id: string, text = "User prompt"): ChatMessage {
  return { id, role: "user", text, time: "12:00" };
}

function agentMessage(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "a1",
    role: "agent",
    time: "12:01",
    startedAtMs: 1000,
    profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
    blocks: [],
    ...patch,
  };
}

function workspace(patch: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    chats: [conversation()],
    threads: { "chat-1": [userMessage("u1"), agentMessage()] },
    selectedId: "chat-1",
    ...patch,
  };
}

describe("applyWorkspaceAgentBlocks", () => {
  it("updates the local thread while skipping persistence for server-owned live output", () => {
    const streamingBlocks: readonly AgentBlock[] = [{ kind: "text", text: "streaming", streaming: true }];

    const update = applyWorkspaceAgentBlocks({
      agentMessage: agentMessage(),
      blocks: streamingBlocks,
      canceled: false,
      conversationId: "chat-1",
      serverOwned: true,
      state: workspace(),
      userMessageId: "u1",
    });

    expect(update.shouldPersistBlocks).toBe(false);
    expect(update.shouldFlush).toBe(false);
    expect(update.state.threads["chat-1"]?.find((message) => message.id === "a1")?.blocks).toEqual(streamingBlocks);
  });

  it("moves the conversation to waiting when incoming blocks need user input", () => {
    const approvalBlock: AgentBlock = { kind: "approval", id: "approval-1", title: "Run command" };

    const update = applyWorkspaceAgentBlocks({
      agentMessage: agentMessage(),
      blocks: [approvalBlock],
      canceled: false,
      conversationId: "chat-1",
      serverOwned: false,
      state: workspace(),
      userMessageId: "u1",
    });

    expect(update.shouldPersistBlocks).toBe(true);
    expect(update.shouldFlush).toBe(true);
    expect(update.state.chats[0]).toMatchObject({ status: "waiting", time: "11:00" });
  });

  it("does not revive a canceled conversation into waiting", () => {
    const approvalBlock: AgentBlock = { kind: "approval", id: "approval-1", title: "Run command" };

    const update = applyWorkspaceAgentBlocks({
      agentMessage: agentMessage(),
      blocks: [approvalBlock],
      canceled: true,
      conversationId: "chat-1",
      serverOwned: false,
      state: workspace({ chats: [conversation({ status: "idle" })] }),
      userMessageId: "u1",
    });

    expect(update.shouldFlush).toBe(true);
    expect(update.state.chats[0]).toMatchObject({ status: "idle", time: "11:00" });
    expect(update.state.threads["chat-1"]?.find((message) => message.id === "a1")?.blocks).toEqual([approvalBlock]);
  });

  it("does not shrink live reasoning when a stale shorter snapshot arrives", () => {
    const previous: AgentBlock = { kind: "reasoning", text: "Inspecting the workspace and checking the route.", active: true };

    const update = applyWorkspaceAgentBlocks({
      agentMessage: agentMessage(),
      blocks: [{ kind: "reasoning", text: "Inspecting", active: true }],
      canceled: false,
      conversationId: "chat-1",
      serverOwned: true,
      state: workspace({ threads: { "chat-1": [userMessage("u1"), agentMessage({ blocks: [previous] })] } }),
      userMessageId: "u1",
    });

    expect(update.state.threads["chat-1"]?.find((message) => message.id === "a1")?.blocks?.[0]).toEqual(previous);
  });

  it("does not shrink live reasoning from background run updates", () => {
    const previous: AgentBlock = { kind: "reasoning", text: "Inspecting the workspace and checking the route.", active: true };
    const next = patchActiveRunUpdate(
      workspace({
        chats: [conversation({ activeRunId: "run-1", status: "running" })],
        threads: { "chat-1": [userMessage("u1"), agentMessage({ blocks: [previous] })] },
      }),
      {
        runId: "run-1",
        conversationId: "chat-1",
        userMessageId: "u1",
        agentMessageId: "a1",
        status: "running",
        time: "12:00",
        agentMessageTime: "12:02",
        updatedAtMs: 120_000,
        done: false,
        blocks: [{ kind: "reasoning", text: "Inspecting", active: true }],
      },
    );

    expect(next.threads["chat-1"]?.find((message) => message.id === "a1")?.blocks?.[0]).toEqual(previous);
  });

  it("uses the runtime profile from background run updates for the agent reply", () => {
    const runtimeProfile = { agent: "codex", model: "default", reasoning: "high", mode: "review" } as const;
    const currentConversationProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" } as const;
    const next = patchActiveRunUpdate(
      workspace({
        chats: [conversation({ activeRunId: "run-1", status: "running", agent: "gemini", profile: currentConversationProfile })],
        threads: { "chat-1": [userMessage("u1"), agentMessage({ profile: currentConversationProfile })] },
      }),
      {
        runId: "run-1",
        conversationId: "chat-1",
        userMessageId: "u1",
        agentMessageId: "a1",
        profile: runtimeProfile,
        status: "running",
        time: "12:00",
        agentMessageTime: "12:02",
        updatedAtMs: 120_000,
        done: false,
        blocks: [{ kind: "text", text: "streaming", streaming: true }],
      },
    );

    expect(next.threads["chat-1"]?.find((message) => message.id === "a1")?.profile).toEqual(runtimeProfile);
  });
});
