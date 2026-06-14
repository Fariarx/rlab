import { describe, expect, it } from "vitest";
import type { AgentBlock, ChatMessage, ConversationSummary } from "../src/components/agent";
import { mergeLoadedThread, mergeRemoteWorkspaceShell, selectedConversationIdAfterRemoteSync } from "../src/components/workspace/models/workspace-server-sync-model";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";

function conversation(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title: id,
    snippet: id,
    time: "12:00",
    status: "idle",
    agent: "codex",
    ...patch,
  };
}

function userMessage(id: string, text = id): ChatMessage {
  return { id, role: "user", text, time: "12:00" };
}

function agentMessage(id: string, blocks: readonly AgentBlock[] = []): ChatMessage {
  return { id, role: "agent", time: "12:01", blocks };
}

function workspace(patch: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    ...patch,
  };
}

describe("workspace-server-sync-model", () => {
  it("chooses a non-archived preferred, server, or first visible selected conversation", () => {
    const state = workspace({
      selectedId: "server",
      chats: [conversation("archived", { archived: true }), conversation("server"), conversation("preferred")],
    });

    expect(selectedConversationIdAfterRemoteSync(state, "preferred")).toBe("preferred");
    expect(selectedConversationIdAfterRemoteSync(state, "missing")).toBe("server");
    expect(selectedConversationIdAfterRemoteSync({ ...state, selectedId: "archived" }, "missing")).toBe("server");
    expect(selectedConversationIdAfterRemoteSync(workspace({ chats: [conversation("archived", { archived: true })] }), "missing")).toBe("archived");
  });

  it("merges a remote workspace shell while keeping local full threads outside the shell", () => {
    const current = workspace({
      selectedId: "chat-1",
      chats: [conversation("chat-1"), conversation("chat-2"), conversation("removed")],
      threads: {
        "chat-1": [userMessage("u1", "local full")],
        "chat-2": [userMessage("u2", "local cached")],
        removed: [userMessage("removed")],
      },
    });
    const serverState = workspace({
      selectedId: "chat-2",
      chats: [conversation("chat-1", { title: "Remote 1" }), conversation("chat-2", { title: "Remote 2" })],
      threads: {
        "chat-1": [userMessage("u1", "server shell")],
      },
    });

    const merge = mergeRemoteWorkspaceShell({
      current,
      serverState,
      preferredSelectedId: "missing",
      activeRuns: new Map(),
    });

    expect(merge.selectedId).toBe("chat-2");
    expect([...merge.knownConversationIds]).toEqual(["chat-1", "chat-2"]);
    expect([...merge.shellThreadIds]).toEqual(["chat-1"]);
    expect(merge.state.chats.map((item) => item.title)).toEqual(["Remote 1", "Remote 2"]);
    expect(merge.state.threads["chat-1"]?.[0]?.text).toBe("server shell");
    expect(merge.state.threads["chat-2"]?.[0]?.text).toBe("local cached");
    expect(merge.state.threads.removed).toBeUndefined();
  });

  it("preserves live active-run messages over stale remote shell messages", () => {
    const liveBlocks: readonly AgentBlock[] = [{ kind: "text", text: "streaming", streaming: true }];
    const current = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running" })],
      threads: {
        "chat-1": [userMessage("u1"), agentMessage("a1", liveBlocks)],
      },
    });
    const serverState = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running" })],
      threads: {
        "chat-1": [userMessage("u1"), agentMessage("a1", [{ kind: "text", text: "stale" }])],
      },
    });

    const merge = mergeRemoteWorkspaceShell({
      current,
      serverState,
      preferredSelectedId: "chat-1",
      activeRuns: new Map([["chat-1", { userMessageId: "u1", agentMessageId: "a1", serverOwned: true }]]),
    });

    expect(merge.state.threads["chat-1"]?.[1]?.blocks).toEqual(liveBlocks);
  });

  it("preserves local messages appended while a thread load was in flight", () => {
    const current = workspace({
      threads: {
        "chat-1": [userMessage("u1", "loaded already"), userMessage("u2", "sent while loading"), agentMessage("a1", [{ kind: "text", text: "streaming" }])],
      },
    });

    const next = mergeLoadedThread(current, "chat-1", [userMessage("u1", "loaded from server")]);

    expect(next.threads["chat-1"]?.map((message) => message.id)).toEqual(["u1", "u2", "a1"]);
    expect(next.threads["chat-1"]?.[0]?.text).toBe("loaded from server");
  });
});
