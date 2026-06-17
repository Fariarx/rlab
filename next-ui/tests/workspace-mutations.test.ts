import { describe, expect, it } from "vitest";
import type { ConversationSummary, Project } from "../src/domain/agent-types";
import type { AgentProfile } from "../src/components/agent";
import { applyWorkspaceMutationsToState } from "../src/lib/workspace-mutations";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";

function conversation(id: string, title = id): ConversationSummary {
  return {
    id,
    title,
    snippet: title,
    time: "12:00",
    status: "idle",
    agent: "codex",
  };
}

function conversationWithProfile(id: string, profile: AgentProfile): ConversationSummary {
  return {
    ...conversation(id),
    agent: profile.agent,
    profile,
  };
}

function project(id: string, conversations: readonly ConversationSummary[] = []): Project {
  return {
    id,
    name: id,
    path: `C:\\work\\${id}`,
    conversations,
  };
}

function workspace(partial: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    ...partial,
  };
}

describe("workspace mutation reducer", () => {
  it("updates existing projects in place without changing project order", () => {
    const state = workspace({
      projects: [project("p1"), project("p2", [conversation("c1")])],
    });

    const next = applyWorkspaceMutationsToState(state, [
      { type: "upsertProject", project: { id: "p2", name: "Renamed", path: "C:\\work\\renamed" }, insertAtFront: true },
    ]);

    expect(next.projects.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(next.projects[1]).toMatchObject({ id: "p2", name: "Renamed", path: "C:\\work\\renamed" });
    expect(next.projects[1]?.conversations.map((item) => item.id)).toEqual(["c1"]);
  });

  it("updates existing conversations in place when they stay in the same collection", () => {
    const state = workspace({
      chats: [conversation("c1"), conversation("c2")],
      projects: [project("p1", [conversation("pc1"), conversation("pc2")])],
    });

    const next = applyWorkspaceMutationsToState(state, [
      { type: "upsertConversation", conversation: { ...conversation("c2"), title: "Root updated" }, projectId: null, insertAtFront: true },
      { type: "upsertConversation", conversation: { ...conversation("pc2"), title: "Project updated" }, projectId: "p1", insertAtFront: true },
    ]);

    expect(next.chats.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(next.chats[1]?.title).toBe("Root updated");
    expect(next.projects[0]?.conversations.map((item) => item.id)).toEqual(["pc1", "pc2"]);
    expect(next.projects[0]?.conversations[1]?.title).toBe("Project updated");
  });

  it("preserves a user-picked profile when a stale run metadata update arrives", () => {
    const codexProfile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "default" };
    const geminiProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };
    const state = workspace({
      chats: [conversationWithProfile("c1", geminiProfile)],
    });

    const next = applyWorkspaceMutationsToState(state, [
      {
        type: "updateConversation",
        conversation: {
          ...conversationWithProfile("c1", codexProfile),
          status: "done",
          snippet: "Finished old run",
          time: "12:01",
        },
      },
    ]);

    expect(next.chats[0]).toMatchObject({
      agent: "gemini",
      profile: geminiProfile,
      status: "done",
      snippet: "Finished old run",
      time: "12:01",
    });
  });

  it("backfills absolute activity timestamps for conversation mutations", () => {
    const state = workspace({
      chats: [conversation("c1")],
    });

    const next = applyWorkspaceMutationsToState(state, [
      {
        type: "updateConversation",
        conversation: { ...conversation("c1"), time: "12:34", updatedAtMs: undefined },
      },
    ]);

    expect(next.chats[0].updatedAtMs).toEqual(expect.any(Number));
    expect(Number.isFinite(next.chats[0].updatedAtMs)).toBe(true);
  });

  it("still applies explicit profile selection mutations", () => {
    const codexProfile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "default" };
    const geminiProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };
    const state = workspace({
      chats: [conversationWithProfile("c1", codexProfile)],
    });

    const next = applyWorkspaceMutationsToState(state, [
      {
        type: "setConversationProfile",
        conversationId: "c1",
        profile: geminiProfile,
      },
    ]);

    expect(next.chats[0]).toMatchObject({ agent: "gemini", profile: geminiProfile });
  });
});
