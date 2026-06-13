import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/domain/agent-types";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";
import {
  closeWorkspaceDb,
  applyWorkspaceDbMutations,
  initializeWorkspaceStateInDb,
  initWorkspaceDb,
  readConversation,
  readMessageBlocks,
  readThreadFromDb,
  readWorkspaceRevision,
  readWorkspaceStateFromDb,
  updateConversationData,
  upsertAgentMessageForUserTurn,
  upsertMessage,
  workspaceDbHasState,
  WorkspaceRevisionConflictError,
} from "../workspace-db";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

const conv = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  snippet: "",
  time: "12:00",
  status: "idle",
  agent: "claude-code",
  ...extra,
});
const msg = (id: string, text: string): ChatMessage => ({ id, role: "agent", blocks: [{ kind: "text", text }] });
const userMsg = (id: string, text: string): ChatMessage => ({ id, role: "user", text, time: "12:00" });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rlab-db-"));
  initWorkspaceDb(join(dir, "workspace.db"));
});
afterEach(() => {
  closeWorkspaceDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("workspace-db", () => {
  it("round-trips a full workspace state through the normalized tables", () => {
    const state: WorkspaceState = {
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1"), conv("c2")],
      projects: [{ id: "p1", name: "Proj", conversations: [conv("pc1")] }],
      threads: { c1: [msg("m1", "one"), msg("m2", "two")], pc1: [msg("pm1", "p")] },
      composerDrafts: { c1: { text: "draft", attachments: [] } },
      selectedId: "c1",
    };
    expect(workspaceDbHasState()).toBe(false);
    initializeWorkspaceStateInDb(state);
    expect(workspaceDbHasState()).toBe(true);

    const read = readWorkspaceStateFromDb();
    expect(read.chats.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(read.projects[0].conversations.map((c) => c.id)).toEqual(["pc1"]);
    expect(read.threads.c1.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(read.threads.pm1).toBeUndefined();
    expect(read.composerDrafts.c1.text).toBe("draft");
    expect(read.selectedId).toBe("c1");
  });

  it("upserts a single message + conversation without rewriting the whole tree (hot path)", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1", { status: "running" })], threads: { c1: [] }, selectedId: "c1" });

    // New streamed message appends; re-upsert updates in place (same id, same row).
    upsertMessage("c1", msg("a1", "partial"));
    upsertMessage("c1", msg("a1", "final"));
    upsertMessage("c1", msg("a2", "next"));
    expect(readMessageBlocks("a1")).toEqual([{ kind: "text", text: "final" }]);
    expect(readWorkspaceStateFromDb().threads.c1.map((m) => m.id)).toEqual(["a1", "a2"]);

    // Conversation row updates in place, other rows untouched.
    const current = readConversation("c1");
    expect(current?.status).toBe("running");
    updateConversationData({ ...current!, status: "done", snippet: "answer" });
    const after = readWorkspaceStateFromDb();
    expect(after.chats[0].status).toBe("done");
    expect(after.chats[0].snippet).toBe("next");
    expect(after.threads.c1).toHaveLength(2);
  });

  it("upserts a bound agent reply after its user turn and deletes stale replies", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1")],
      threads: {
        c1: [userMsg("u1", "try again"), msg("a-stale-1", "old failure"), msg("a-stale-2", "old duplicate"), userMsg("u2", "later"), msg("a-later", "later answer")],
      },
      selectedId: "c1",
    });

    upsertAgentMessageForUserTurn("c1", "u1", msg("a-new", "new answer"));
    expect(readThreadFromDb("c1").map((message) => message.id)).toEqual(["u1", "a-new", "u2", "a-later"]);

    upsertAgentMessageForUserTurn("c1", "u1", msg("a-new", "final answer"));
    const thread = readThreadFromDb("c1");
    expect(thread.map((message) => message.id)).toEqual(["u1", "a-new", "u2", "a-later"]);
    expect(thread[1].blocks).toEqual([{ kind: "text", text: "final answer" }]);
  });

  it("inserts a bound agent reply before an immediate next user turn", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1")],
      threads: { c1: [userMsg("u1", "first"), userMsg("u2", "second")] },
      selectedId: "c1",
    });

    upsertAgentMessageForUserTurn("c1", "u1", msg("a1", "answer"));

    expect(readThreadFromDb("c1").map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("rejects a bound agent reply when the user turn is missing", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [msg("a1", "answer")] }, selectedId: "c1" });

    expect(() => upsertAgentMessageForUserTurn("c1", "u-missing", msg("a-new", "new answer"))).toThrow("User message u-missing is missing");
  });

  it("filtered read loads only the requested threads; readThreadFromDb loads one", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1"), conv("c2")], threads: { c1: [msg("m1", "a")], c2: [msg("m2", "b")] }, selectedId: "c1" });
    const shell = readWorkspaceStateFromDb(new Set(["c1"]));
    expect(shell.threads.c1).toHaveLength(1);
    expect(shell.threads.c2).toBeUndefined();
    expect(readThreadFromDb("c2").map((m) => m.id)).toEqual(["m2"]);
  });

  it("derives shell conversation snippets from user/model text without loading every thread", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { snippet: "Run failed" }), conv("c2", { snippet: "Needs input" })],
      threads: {
        c1: [msg("m1", "selected answer")],
        c2: [
          userMsg("u2", "Unloaded user prompt"),
          { id: "a2", role: "agent", blocks: [{ kind: "status", level: "error", text: "Run failed" }] },
        ],
      },
      selectedId: "c1",
    });

    const shell = readWorkspaceStateFromDb(new Set(["c1"]));

    expect(shell.threads.c2).toBeUndefined();
    expect(shell.chats.find((conversation) => conversation.id === "c1")?.snippet).toBe("selected answer");
    expect(shell.chats.find((conversation) => conversation.id === "c2")?.snippet).toBe("Unloaded user prompt");
  });

  it("applies row-level conversation mutations without touching unrelated threads", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1"), conv("c2"), conv("c3")],
      threads: { c1: [msg("m1", "a")], c2: [msg("m2", "b")], c3: [msg("m3", "c")] },
      selectedId: "c1",
    });
    applyWorkspaceDbMutations([
      { type: "updateConversation", conversation: conv("c1") },
      { type: "updateConversation", conversation: conv("c2") },
      { type: "deleteConversation", conversationId: "c3" },
      { type: "replaceConversationThread", conversationId: "c1", messages: [msg("m1", "a2"), msg("m1b", "x")] },
      { type: "setSelectedConversation", conversationId: "c1" },
    ]);
    const read = readWorkspaceStateFromDb();
    expect(read.chats.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(read.threads.c1.map((m) => m.id)).toEqual(["m1", "m1b"]); // replaced
    expect(read.threads.c2.map((m) => m.id)).toEqual(["m2"]); // preserved (lazy, not sent)
    expect(read.threads.c3).toBeUndefined(); // deleted conversation → messages dropped
  });

  it("updates a conversation row without rewriting its thread", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1")],
      threads: { c1: [msg("m1", "a")] },
      selectedId: "c1",
    });

    applyWorkspaceDbMutations([{ type: "updateConversation", conversation: conv("c1", { title: "renamed" }) }]);

    const read = readWorkspaceStateFromDb();
    expect(read.chats.find((conversation) => conversation.id === "c1")?.title).toBe("renamed");
    expect(read.threads.c1.map((message) => message.id)).toEqual(["m1"]);
  });

  it("rejects mutation batches with a stale expected revision", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });
    const baseRevision = readWorkspaceRevision();
    applyWorkspaceDbMutations([{ type: "updateConversation", conversation: conv("c1", { title: "server edit" }) }], { expectedRevision: baseRevision });

    expect(() =>
      applyWorkspaceDbMutations([{ type: "updateConversation", conversation: conv("c1", { title: "stale edit" }) }], { expectedRevision: baseRevision }),
    ).toThrow(WorkspaceRevisionConflictError);
    expect(readWorkspaceStateFromDb().chats[0]?.title).toBe("server edit");
  });

  it("rejects messages for missing conversations", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });

    expect(() => applyWorkspaceDbMutations([{ type: "upsertMessage", conversationId: "missing", message: msg("m1", "a") }])).toThrow("Conversation missing does not exist.");
  });

  it("rejects moving an existing message id into another conversation", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1"), conv("c2")],
      threads: { c1: [msg("m1", "a")], c2: [] },
      selectedId: "c1",
    });

    expect(() => applyWorkspaceDbMutations([{ type: "upsertMessage", conversationId: "c2", message: msg("m1", "b") }])).toThrow(
      "Message m1 already belongs to conversation c1.",
    );
    expect(readWorkspaceStateFromDb().threads.c1.map((message) => message.id)).toEqual(["m1"]);
  });

  it("rejects selected conversation and draft mutations for missing conversations", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });

    expect(() => applyWorkspaceDbMutations([{ type: "setSelectedConversation", conversationId: "missing" }])).toThrow("Conversation missing does not exist.");
    expect(() => applyWorkspaceDbMutations([{ type: "setComposerDraft", conversationId: "missing", draft: { text: "x", attachments: [] } }])).toThrow(
      "Conversation missing does not exist.",
    );
  });

  it("rejects databases without declared foreign keys", () => {
    const schemaFile = join(dir, "outdated.db");
    closeWorkspaceDb();
    const outdated = new DatabaseSync(schemaFile);
    outdated.exec(`
CREATE TABLE projects (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, position INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE composer_drafts (conversation_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO conversations(id, project_id, position, data) VALUES('c1', NULL, 0, '${JSON.stringify(conv("c1")).replace(/'/g, "''")}');
INSERT INTO messages(id, conversation_id, position, data) VALUES('m1', 'c1', 0, '${JSON.stringify(msg("m1", "answer")).replace(/'/g, "''")}');
INSERT INTO composer_drafts(conversation_id, data) VALUES('c1', '${JSON.stringify({ text: "draft", attachments: [] }).replace(/'/g, "''")}');
`);
    outdated.close();

    expect(() => initWorkspaceDb(schemaFile)).toThrow("Workspace database schema is outdated");
  });
});
