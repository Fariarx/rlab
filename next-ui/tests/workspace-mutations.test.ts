import { describe, expect, it } from "vitest";
import type { ConversationSummary, Project } from "../src/domain/agent-types";
import type { AgentProfile } from "../src/components/agent";
import { applyWorkspaceMutationsToState, parseWorkspaceMutation } from "../src/lib/workspace-mutations";
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

  it("keeps an explicit empty thread when creating a conversation with no messages", () => {
    const state = workspace({});
    const newConversation = conversation("chat-new");

    const next = applyWorkspaceMutationsToState(state, [
      { type: "upsertConversation", conversation: newConversation, projectId: null, insertAtFront: true },
      { type: "upsertMessages", conversationId: newConversation.id, messages: [] },
      { type: "setSelectedConversation", conversationId: newConversation.id },
    ]);

    expect(next.selectedId).toBe(newConversation.id);
    expect(next.chats[0]?.id).toBe(newConversation.id);
    expect(next.threads[newConversation.id]).toEqual([]);
  });

  it("restarts a user turn without dropping earlier messages", () => {
    const state = workspace({
      chats: [conversation("c1")],
      threads: {
        c1: [
          { id: "u1", role: "user", text: "first", time: "12:00" },
          { id: "a1", role: "agent", blocks: [{ kind: "text", text: "old answer" }] },
          { id: "u2", role: "user", text: "second", time: "12:01" },
          { id: "a2", role: "agent", blocks: [{ kind: "text", text: "second answer" }] },
        ],
      },
    });

    const next = applyWorkspaceMutationsToState(state, [
      { type: "restartUserTurn", conversationId: "c1", userMessage: { id: "u2", role: "user", text: "edited second", time: "12:02" } },
    ]);

    expect(next.threads.c1?.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(next.threads.c1?.at(-1)).toMatchObject({ role: "user", text: "edited second" });
  });

  it("appends a missing restarted user turn instead of no-oping during rebase", () => {
    const state = workspace({
      chats: [conversation("c1")],
      threads: {
        c1: [{ id: "u1", role: "user", text: "first", time: "12:00" }],
      },
    });

    const next = applyWorkspaceMutationsToState(state, [
      { type: "restartUserTurn", conversationId: "c1", userMessage: { id: "u2", role: "user", text: "second", time: "12:01" } },
    ]);

    expect(next.threads.c1?.map((message) => message.id)).toEqual(["u1", "u2"]);
  });

  it("rejects full thread replacement from parsed client mutations", () => {
    expect(() => parseWorkspaceMutation({ type: "replaceConversationThread", conversationId: "c1", messages: [] })).toThrow("Full thread replacement is disabled.");
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
