import { describe, expect, it } from "vitest";
import type { ConversationSummary, Project } from "../src/domain/agent-types";
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
});
