import { describe, expect, it } from "vitest";
import type { AgentBlock, ChatMessage, ConversationSummary } from "../src/components/agent";
import { hasUntrackedPersistedActiveRuns, mergeBackgroundRunState } from "../src/components/workspace/models/workspace-background-runs-model";
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

function agentMessage(id: string, blocks: readonly AgentBlock[]): ChatMessage {
  return { id, role: "agent", time: "12:01", blocks };
}

function workspace(patch: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    ...patch,
  };
}

describe("workspace-background-runs-model", () => {
  it("detects persisted active runs that are not tracked locally", () => {
    const state = workspace({
      chats: [
        conversation("tracked", { activeRunId: "run-tracked", status: "running" }),
        conversation("untracked", { activeRunId: "run-untracked", status: "waiting" }),
        conversation("finished", { activeRunId: "run-finished", status: "done" }),
      ],
    });
    const trackedRuns = new Map<string, unknown>([["tracked", {}]]);

    expect(hasUntrackedPersistedActiveRuns(state, trackedRuns)).toBe(true);
    expect(hasUntrackedPersistedActiveRuns(workspace({ chats: [conversation("tracked", { activeRunId: "run-tracked", status: "running" })] }), trackedRuns)).toBe(false);
  });

  it("settles orphaned persisted runs when the server no longer lists the run id", () => {
    const runningBlock: AgentBlock = { kind: "reasoning", text: "working", active: true };
    const current = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running" })],
      threads: {
        "chat-1": [userMessage("u1", "question"), agentMessage("a1", [runningBlock])],
      },
    });
    const loaded = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running" })],
      threads: {
        "chat-1": [userMessage("u1", "server question"), agentMessage("a1", [{ kind: "text", text: "server answer" }])],
      },
    });

    const next = mergeBackgroundRunState({
      current,
      loaded,
      activeRunIds: new Set(),
      trackedRuns: new Map(),
    });

    expect(next.chats[0]).toMatchObject({ id: "chat-1", activeRunId: undefined, status: "error", snippet: "server answer" });
    expect(next.threads["chat-1"]?.[1]?.blocks).toEqual([{ kind: "reasoning", text: "working", active: false }]);
  });

  it("adopts the loaded conversation and thread while the server still owns the run", () => {
    const current = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running", snippet: "old" })],
      threads: {
        "chat-1": [userMessage("u1", "old")],
      },
    });
    const loaded = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "waiting", snippet: "new" })],
      threads: {
        "chat-1": [userMessage("u1", "new"), agentMessage("a1", [{ kind: "text", text: "answer" }])],
      },
    });

    const next = mergeBackgroundRunState({
      current,
      loaded,
      activeRunIds: new Set(["run-1"]),
      trackedRuns: new Map(),
    });

    expect(next.chats[0]).toMatchObject({ id: "chat-1", activeRunId: "run-1", status: "waiting", snippet: "new" });
    expect(next.threads["chat-1"]?.map((message) => message.text ?? message.blocks?.[0]?.kind)).toEqual(["new", "text"]);
  });

  it("does not rewrite conversations that already have a local run handle", () => {
    const current = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "running", snippet: "local" })],
      threads: {
        "chat-1": [userMessage("u1", "local")],
      },
    });
    const loaded = workspace({
      chats: [conversation("chat-1", { activeRunId: "run-1", status: "waiting", snippet: "server" })],
      threads: {
        "chat-1": [userMessage("u1", "server")],
      },
    });

    const next = mergeBackgroundRunState({
      current,
      loaded,
      activeRunIds: new Set(["run-1"]),
      trackedRuns: new Map<string, unknown>([["chat-1", {}]]),
    });

    expect(next).toBe(current);
  });
});
