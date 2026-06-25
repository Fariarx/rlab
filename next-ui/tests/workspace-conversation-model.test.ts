import { describe, expect, it } from "vitest";
import type { AgentProfile, ChatMessage, ComposerAttachmentDraft, ConversationSummary, Project } from "../src/components/agent";
import {
  archiveConversationState,
  buildForkConversationTitle,
  buildIdleConversation,
  cloneComposerDraft,
  composerDraftMutation,
  createProjectConversationState,
  createProjectWithConversationState,
  createStandaloneConversationState,
  forkConversationState,
  insertProjectConversationState,
  insertProjectWithConversationState,
  insertStandaloneConversationState,
  putComposerDraftState,
  renameConversationState,
  removeConversationState,
  reorderPinnedConversationsState,
  selectedConversationIdForState,
  stopRunConversationState,
  toggleConversationPinState,
  updateConversationProfileState,
} from "../src/components/workspace/models/workspace-conversation-model";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";

const profile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "default" };

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

function project(id: string, conversations: readonly ConversationSummary[] = []): Project {
  return {
    id,
    name: id,
    path: `C:\\work\\${id}`,
    conversations,
  };
}

function workspace(patch: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    ...patch,
  };
}

function message(id: string): ChatMessage {
  return { id, role: "user", text: id, time: "12:00" };
}

function agentMessage(id: string, text = id): ChatMessage {
  return {
    id,
    role: "agent",
    time: "12:01",
    profile: { agent: "gemini", model: "default", reasoning: "default", mode: "default" },
    blocks: [{ kind: "text", text, streaming: true }],
  };
}

function attachment(id: string): ComposerAttachmentDraft {
  return {
    id,
    name: `${id}.txt`,
    type: "text/plain",
    content: "hello",
    size: 5,
    lastModified: 1,
  };
}

describe("workspace-conversation-model", () => {
  it("builds numbered fork titles without nesting legacy prefixes", () => {
    expect(buildForkConversationTitle("Release notes")).toBe("Fork #1: Release notes");
    expect(buildForkConversationTitle("Форк: Release notes")).toBe("Fork #1: Release notes");
    expect(buildForkConversationTitle("Fork: Release notes")).toBe("Fork #1: Release notes");
    expect(buildForkConversationTitle("Fork #1: Release notes")).toBe("Fork #2: Release notes");
    expect(buildForkConversationTitle("Fork #12: Release notes")).toBe("Fork #13: Release notes");
  });

  it("builds idle conversations from an agent profile", () => {
    expect(buildIdleConversation({ id: "chat-1", title: "New", snippet: "Empty", time: "12:00", updatedAtMs: 1000, profile })).toEqual({
      id: "chat-1",
      title: "New",
      snippet: "Empty",
      time: "12:00",
      updatedAtMs: 1000,
      status: "idle",
      agent: "codex",
      profile,
    });
  });

  it("inserts standalone, project, and new-project conversations consistently", () => {
    const thread = [message("u1")];
    const rootConversation = conversation("chat-root");
    const rootState = insertStandaloneConversationState(workspace({ chats: [conversation("existing")] }), rootConversation, thread);

    expect(rootState.selectedId).toBe("chat-root");
    expect(rootState.chats.map((item) => item.id)).toEqual(["chat-root", "existing"]);
    expect(rootState.threads["chat-root"]).toEqual(thread);
    expect(rootState.threads["chat-root"]).not.toBe(thread);

    const projectConversation = conversation("chat-project");
    const projectState = insertProjectConversationState(workspace({ projects: [project("p1", [conversation("old")])] }), "p1", projectConversation, thread);

    expect(projectState.selectedId).toBe("chat-project");
    expect(projectState.projects[0]?.conversations.map((item) => item.id)).toEqual(["chat-project", "old"]);

    const createdProjectState = insertProjectWithConversationState(workspace({ projects: [project("old-project")] }), { id: "p2", name: "P2", path: "C:\\work\\p2" }, conversation("chat-p2"), thread);

    expect(createdProjectState.projects.map((item) => item.id)).toEqual(["p2", "old-project"]);
    expect(createdProjectState.projects[0]?.conversations.map((item) => item.id)).toEqual(["chat-p2"]);
    expect(createdProjectState.selectedId).toBe("chat-p2");
  });

  it("creates standalone conversation state with persistence-ready data", () => {
    const thread = [message("u1")];
    const state = workspace({ chats: [conversation("existing")] });

    const result = createStandaloneConversationState({
      id: "chat-new",
      profile,
      snippet: "Empty",
      state,
      thread,
      time: "13:00",
      updatedAtMs: 1300,
      title: "New",
    });

    expect(result.conversation).toEqual({
      id: "chat-new",
      title: "New",
      snippet: "Empty",
      time: "13:00",
      updatedAtMs: 1300,
      status: "idle",
      agent: "codex",
      profile,
    });
    expect(result.state.selectedId).toBe("chat-new");
    expect(result.state.chats.map((item) => item.id)).toEqual(["chat-new", "existing"]);
    expect(result.thread).toEqual(thread);
    expect(result.thread).not.toBe(thread);
  });

  it("creates project conversation state and rejects missing projects", () => {
    const thread = [message("u1")];
    const state = workspace({ projects: [project("p1", [conversation("old")])] });

    const result = createProjectConversationState({
      id: "chat-new",
      projectId: "p1",
      profile,
      snippet: "Empty",
      state,
      thread,
      time: "13:00",
      updatedAtMs: 1300,
      title: "New",
    });

    expect(result.state.projects[0]?.conversations.map((item) => item.id)).toEqual(["chat-new", "old"]);
    expect(result.state.selectedId).toBe("chat-new");
    expect(() =>
      createProjectConversationState({
        id: "chat-new",
        projectId: "missing",
        profile,
        snippet: "Empty",
        state,
        thread,
        time: "13:00",
        updatedAtMs: 1300,
        title: "New",
      }),
    ).toThrow("Project missing was not found.");
  });

  it("creates project-with-conversation state and rejects duplicate project ids", () => {
    const thread = [message("u1")];
    const state = workspace({ projects: [project("existing")] });

    const result = createProjectWithConversationState({
      id: "chat-new",
      project: { id: "p2", name: "P2", path: "C:\\work\\p2" },
      profile,
      snippet: "Empty",
      state,
      thread,
      time: "13:00",
      updatedAtMs: 1300,
      title: "New",
    });

    expect(result.project).toEqual({ id: "p2", name: "P2", path: "C:\\work\\p2" });
    expect(result.state.projects.map((item) => item.id)).toEqual(["p2", "existing"]);
    expect(result.state.projects[0]?.conversations.map((item) => item.id)).toEqual(["chat-new"]);
    expect(() =>
      createProjectWithConversationState({
        id: "chat-new",
        project: { id: "existing", name: "Existing", path: "C:\\work\\existing" },
        profile,
        snippet: "Empty",
        state,
        thread,
        time: "13:00",
        updatedAtMs: 1300,
        title: "New",
      }),
    ).toThrow("Project existing already exists.");
  });

  it("removes conversations, associated local state, and selects the next visible conversation", () => {
    const archived = conversation("archived", { archived: true });
    const state = workspace({
      chats: [archived, conversation("chat-1"), conversation("chat-2")],
      projects: [project("p1", [conversation("project-chat")])],
      threads: {
        "chat-1": [message("u1")],
        "chat-2": [message("u2")],
      },
      composerDrafts: {
        "chat-1": { text: "draft", attachments: [] },
      },
      selectedId: "chat-1",
    });

    const result = removeConversationState(state, "chat-1");

    expect(result.selectedId).toBe("chat-2");
    expect(result.state.selectedId).toBe("chat-2");
    expect(result.state.chats.map((item) => item.id)).toEqual(["archived", "chat-2"]);
    expect(result.state.threads["chat-1"]).toBeUndefined();
    expect(result.state.composerDrafts["chat-1"]).toBeUndefined();
  });

  it("updates conversation metadata through explicit state transitions", () => {
    const geminiProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };
    const state = workspace({
      chats: [conversation("chat-1", { pinned: false, profile })],
    });

    const withProfile = updateConversationProfileState(state, "chat-1", geminiProfile);
    expect(withProfile?.conversation).toMatchObject({ id: "chat-1", agent: "gemini", profile: geminiProfile });
    expect(withProfile?.state.chats[0]).toBe(withProfile?.conversation);

    const renamed = renameConversationState(withProfile?.state ?? state, "chat-1", "  Renamed  ");
    expect(renamed?.conversation.title).toBe("Renamed");
    expect(renameConversationState(renamed?.state ?? state, "chat-1", "   ")).toBeNull();

    const pinned = toggleConversationPinState(renamed?.state ?? state, "chat-1");
    expect(pinned?.conversation.pinned).toBe(true);
    expect(pinned?.conversation.pinnedOrder).toBe(1024);
    const unpinned = toggleConversationPinState(pinned?.state ?? state, "chat-1");
    expect(unpinned?.conversation.pinned).toBe(false);
    expect(unpinned?.conversation.pinnedOrder).toBeUndefined();
    expect(toggleConversationPinState(state, "missing")).toBeNull();
  });

  it("reorders pinned conversations without moving their original collections", () => {
    const state = workspace({
      chats: [conversation("root-a", { pinned: true, pinnedOrder: 1024 }), conversation("root-b", { pinned: true, pinnedOrder: 2048 })],
      projects: [project("p1", [conversation("project-a", { pinned: true, pinnedOrder: 3072 }), conversation("project-plain")])],
    });

    const result = reorderPinnedConversationsState(state, ["project-a", "root-b", "root-a"]);

    expect(result?.state.chats.map((item) => item.id)).toEqual(["root-a", "root-b"]);
    expect(result?.state.projects[0]?.conversations.map((item) => item.id)).toEqual(["project-a", "project-plain"]);
    expect(result?.state.chats.map((item) => item.pinnedOrder)).toEqual([3072, 2048]);
    expect(result?.state.projects[0]?.conversations[0]?.pinnedOrder).toBe(1024);
    expect(result?.conversations).toHaveLength(2);
  });

  it("archives conversations, clears active run state, and deselects archived active chats", () => {
    const state = workspace({
      chats: [
        conversation("chat-1", {
          activeRunId: "run-1",
          pinned: true,
          status: "running",
        }),
        conversation("chat-2"),
      ],
      selectedId: "chat-1",
    });

    const result = archiveConversationState(state, "chat-1");

    expect(result.selectedId).toBe("");
    expect(result.conversation).toMatchObject({
      id: "chat-1",
      activeRunId: undefined,
      archived: true,
      pinned: false,
      pinnedOrder: undefined,
      status: "idle",
    });
    expect(result.state.chats[0]).toBe(result.conversation);
  });

  it("stops running conversations and settles live blocks in the thread", () => {
    const state = workspace({
      chats: [
        conversation("chat-1", {
          activeRunId: "run-1",
          snippet: "old",
          status: "waiting",
        }),
      ],
      threads: {
        "chat-1": [message("u1"), agentMessage("a1", "new answer")],
      },
      selectedId: "chat-1",
    });

    const result = stopRunConversationState(state, "chat-1", "13:00", "Запуск остановлен");

    expect(result.conversation).toMatchObject({
      id: "chat-1",
      activeRunId: undefined,
      snippet: "new answer",
      status: "idle",
      time: "13:00",
    });
    expect(result.thread[1]?.blocks).toEqual([
      { kind: "text", text: "new answer", streaming: false, result: false },
      { kind: "status", level: "warn", text: "Запуск остановлен", surface: true },
    ]);
    expect(result.state.threads["chat-1"]?.[1]).toBe(result.thread[1]);
  });

  it("settles stop-run thread state without forcing idle status for already idle conversations", () => {
    const state = workspace({
      chats: [conversation("chat-1", { status: "idle", snippet: "old" })],
      threads: {
        "chat-1": [agentMessage("a1", "partial")],
      },
    });

    const result = stopRunConversationState(state, "chat-1", "13:00");

    expect(result.conversation).toMatchObject({ id: "chat-1", snippet: "old", status: "idle", time: "12:00" });
    expect(result.thread[0]?.blocks).toEqual([{ kind: "text", text: "partial", streaming: false, result: true }]);
  });

  it("forks a standalone conversation from an agent message", () => {
    let nextIndex = 0;
    const source = conversation("chat-1", {
      title: "Original",
      status: "done",
      activeRunId: "run-1",
      pinned: true,
      usage: { totalTokens: 100 },
      sessionId: "old-session",
      sessionAgent: "codex",
      agentSessions: { codex: "old-session" },
    });
    const state = workspace({
      chats: [source],
      threads: { "chat-1": [message("u1"), agentMessage("a1", "answer"), message("u2")] },
      selectedId: "chat-1",
    });

    const result = forkConversationState({
      conversationId: "chat-1",
      forkId: "chat-fork",
      forkTitle: "Forked Original",
      messageId: "a1",
      nextId: (prefix) => `${prefix}-fork-${++nextIndex}`,
      state,
      time: "13:00",
    });

    expect(result?.projectId).toBeNull();
    expect(result?.conversation).toMatchObject({
      id: "chat-fork",
      title: "Forked Original",
      time: "13:00",
      status: "idle",
      agent: "gemini",
      activeRunId: undefined,
      pinned: false,
      pinnedOrder: undefined,
      usage: undefined,
      sessionId: undefined,
      sessionAgent: undefined,
      agentSessions: undefined,
    });
    expect(result?.state.selectedId).toBe("chat-fork");
    expect(result?.state.chats.map((item) => item.id)).toEqual(["chat-fork", "chat-1"]);
    expect(result?.thread.map((item) => item.id)).toEqual(["u-fork-1", "a-fork-2"]);
    expect(result?.thread[1]?.blocks).toEqual([{ kind: "text", text: "answer", streaming: false }]);
  });

  it("forks project conversations back into the project instead of root chats", () => {
    const source = conversation("project-chat");
    const state = workspace({
      chats: [conversation("root-chat")],
      projects: [project("p1", [source])],
      threads: { "project-chat": [message("u1"), agentMessage("a1")] },
      selectedId: "project-chat",
    });

    const result = forkConversationState({
      conversationId: "project-chat",
      forkId: "chat-fork",
      forkTitle: "Forked Project Chat",
      messageId: "a1",
      nextId: (prefix) => `${prefix}-fork`,
      state,
      time: "13:00",
    });

    expect(result?.projectId).toBe("p1");
    expect(result?.state.chats.map((item) => item.id)).toEqual(["root-chat"]);
    expect(result?.state.projects[0]?.conversations.map((item) => item.id)).toEqual(["chat-fork", "project-chat"]);
  });

  it("does not fork from missing or non-agent messages", () => {
    const state = workspace({
      chats: [conversation("chat-1")],
      threads: { "chat-1": [message("u1")] },
    });

    expect(
      forkConversationState({
        conversationId: "chat-1",
        forkId: "chat-fork",
        forkTitle: "Forked",
        messageId: "u1",
        nextId: (prefix) => `${prefix}-fork`,
        state,
        time: "13:00",
      }),
    ).toBeNull();
  });

  it("keeps the preferred selection when it still exists", () => {
    const state = workspace({
      chats: [conversation("chat-1"), conversation("chat-2")],
      selectedId: "chat-2",
    });

    expect(selectedConversationIdForState(state, "chat-2")).toBe("chat-2");
    expect(removeConversationState(state, "chat-1").selectedId).toBe("chat-2");
  });

  it("clones composer drafts and maps empty drafts to delete mutations", () => {
    const sourceAttachment = attachment("a1");
    const sourceDraft = { text: "draft", attachments: [sourceAttachment] };
    const cloned = cloneComposerDraft(sourceDraft);

    expect(cloned).toEqual(sourceDraft);
    expect(cloned.attachments[0]).not.toBe(sourceAttachment);

    const state = workspace({});
    const next = putComposerDraftState(state, "chat-1", sourceDraft);
    expect(next.composerDrafts["chat-1"]).toEqual(sourceDraft);
    expect(next.composerDrafts["chat-1"]?.attachments[0]).not.toBe(sourceAttachment);
    expect(putComposerDraftState(next, "chat-1", sourceDraft)).toBe(next);
    const cleared = putComposerDraftState(next, "chat-1", { text: "  ", attachments: [] });
    expect(cleared.composerDrafts["chat-1"]).toBeUndefined();
    expect(putComposerDraftState(cleared, "chat-1", { text: "", attachments: [] })).toBe(cleared);

    expect(composerDraftMutation("chat-1", { text: "  ", attachments: [] })).toEqual({ type: "deleteComposerDraft", conversationId: "chat-1" });
    expect(composerDraftMutation("chat-1", sourceDraft)).toEqual({ type: "setComposerDraft", conversationId: "chat-1", draft: sourceDraft });
  });
});
