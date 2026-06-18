import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/domain/agent-types";
import type { AgentProfile } from "../src/components/agent";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";
import {
  closeWorkspaceDb,
  applyWorkspaceDbMutations,
  claimNextPendingTurn,
  deletePendingTurn,
  enqueuePendingTurn,
  initializeWorkspaceStateInDb,
  initWorkspaceDb,
  patchMessageBlockById,
  readConversation,
  readMessageBlocks,
  readPendingTurnQueue,
  readThreadPageFromDb,
  readThreadFromDb,
  readWorkspaceRevision,
  readWorkspaceStateFromDb,
  releasePendingTurn,
  removePendingTurn,
  resetDispatchingPendingTurns,
  searchConversationIds,
  setPendingTurnQueuePaused,
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
const codexProfile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "default" };
const geminiProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };

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

  it("backfills absolute conversation activity timestamps when reading legacy rows", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { time: "12:00", updatedAtMs: undefined })],
      threads: { c1: [] },
      selectedId: "c1",
    });

    const read = readWorkspaceStateFromDb();

    expect(read.chats[0].updatedAtMs).toEqual(expect.any(Number));
    expect(Number.isFinite(read.chats[0].updatedAtMs)).toBe(true);
  });

  it("persists pending user turns server-side and claims them in FIFO order", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });

    enqueuePendingTurn({ id: "u-pending-1", conversationId: "c1", createdAtMs: 100, message: userMsg("u-pending-1", "first"), origin: "http://127.0.0.1:4280" });
    enqueuePendingTurn({ id: "u-pending-2", conversationId: "c1", createdAtMs: 200, message: userMsg("u-pending-2", "second"), origin: "http://127.0.0.1:4280" });

    expect(readPendingTurnQueue("c1").messages.map((message) => message.id)).toEqual(["u-pending-1", "u-pending-2"]);

    expect(setPendingTurnQueuePaused("c1", true).paused).toBe(true);
    expect(claimNextPendingTurn("c1", "run-paused")).toBeNull();
    expect(setPendingTurnQueuePaused("c1", false).paused).toBe(false);

    const claimed = claimNextPendingTurn("c1", "run-1");
    expect(claimed?.message.text).toBe("first");
    expect(readPendingTurnQueue("c1").messages.map((message) => message.id)).toEqual(["u-pending-2"]);

    expect(removePendingTurn("c1", "u-pending-2").messages).toEqual([]);
    expect(releasePendingTurn("u-pending-1", { pause: true })?.message.id).toBe("u-pending-1");
    expect(readPendingTurnQueue("c1")).toMatchObject({ paused: true, messages: [expect.objectContaining({ id: "u-pending-1" })] });

    expect(setPendingTurnQueuePaused("c1", false).paused).toBe(false);
    expect(claimNextPendingTurn("c1", "run-2")?.id).toBe("u-pending-1");
    deletePendingTurn("u-pending-1");
    expect(readPendingTurnQueue("c1").messages).toEqual([]);
  });

  it("requeues dispatching pending turns after a server restart", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });
    enqueuePendingTurn({ id: "u-pending", conversationId: "c1", createdAtMs: 100, message: userMsg("u-pending", "first"), origin: "http://127.0.0.1:4280" });

    expect(claimNextPendingTurn("c1", "run-1")?.id).toBe("u-pending");
    expect(readPendingTurnQueue("c1").messages).toEqual([]);

    resetDispatchingPendingTurns();

    expect(readPendingTurnQueue("c1")).toMatchObject({ paused: true, messages: [expect.objectContaining({ id: "u-pending" })] });
  });

  it("cascades pending turn queues when a conversation is deleted", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [] }, selectedId: "c1" });
    enqueuePendingTurn({ id: "u-pending", conversationId: "c1", createdAtMs: 100, message: userMsg("u-pending", "first"), origin: "http://127.0.0.1:4280" });
    setPendingTurnQueuePaused("c1", true);

    applyWorkspaceDbMutations([{ type: "deleteConversation", conversationId: "c1" }]);

    expect(() => readPendingTurnQueue("c1")).toThrow("Conversation c1 does not exist.");
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

  it("reads conversation threads by pages from the newest messages backward", () => {
    const messages = Array.from({ length: 25 }, (_, index) => msg(`m${index + 1}`, `message ${index + 1}`));
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: messages }, selectedId: "c1" });

    const latest = readThreadPageFromDb("c1", { limit: 15 });
    expect(latest.messages.map((message) => message.id)).toEqual(messages.slice(10).map((message) => message.id));
    expect(latest.hasMoreBefore).toBe(true);
    expect(latest.nextBefore).toBe(10);

    const older = readThreadPageFromDb("c1", { limit: 15, before: latest.nextBefore });
    expect(older.messages.map((message) => message.id)).toEqual(messages.slice(0, 10).map((message) => message.id));
    expect(older.hasMoreBefore).toBe(false);
  });

  it("keeps shell reads on persisted snippets without loading every thread", () => {
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
    expect(shell.chats.find((conversation) => conversation.id === "c1")?.snippet).toBe("Run failed");
    expect(shell.chats.find((conversation) => conversation.id === "c2")?.snippet).toBe("Needs input");
  });

  it("patches a single interactive message block without loading workspace state", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { status: "waiting" }), conv("c2", { status: "idle" })],
      threads: {
        c1: [
          {
            id: "a1",
            role: "agent",
            blocks: [
              { kind: "approval", id: "approval-1", title: "Approve?", decision: undefined },
              { kind: "options", id: "question-1", prompt: "Pick", options: [{ id: "A", label: "A" }] },
            ],
          },
        ],
        c2: [msg("a2", "other")],
      },
      selectedId: "c1",
    });

    expect(
      patchMessageBlockById("question-1", (block) => (block.kind === "options" && block.id === "question-1" ? { ...block, selected: ["A"] } : block)),
    ).toEqual(["c1"]);

    const c1 = readWorkspaceStateFromDb().threads.c1[0];
    expect(c1.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "options", id: "question-1", selected: ["A"] })]));
    expect(readConversation("c1")?.status).toBe("running");
    expect(readThreadFromDb("c2").map((message) => message.id)).toEqual(["a2"]);
  });

  it("searches conversations server-side and returns ids only", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { title: "Deploy notes" }), conv("c2", { title: "Other" })],
      threads: {
        c1: [userMsg("u1", "hello")],
        c2: [userMsg("u2", "needle appears only in the message body")],
      },
      selectedId: "c1",
    });

    expect(searchConversationIds("deploy")).toEqual(["c1"]);
    expect(searchConversationIds("needle")).toEqual(["c2"]);
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

  it("front-inserts conversations without transient position collisions", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), selectedId: "" });

    applyWorkspaceDbMutations([
      { type: "upsertConversation", conversation: conv("c1"), projectId: null, insertAtFront: true },
      { type: "upsertConversation", conversation: conv("c2"), projectId: null, insertAtFront: true },
      { type: "upsertConversation", conversation: conv("c3"), projectId: null, insertAtFront: true },
    ]);

    expect(readWorkspaceStateFromDb().chats.map((conversation) => conversation.id)).toEqual(["c3", "c2", "c1"]);
  });

  it("reads conversations newest first inside root and project collections", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [
        conv("root-old", { updatedAtMs: 1000 }),
        conv("root-new", { updatedAtMs: 3000 }),
        conv("root-middle", { updatedAtMs: 2000 }),
      ],
      projects: [
        {
          id: "p1",
          name: "Project",
          conversations: [
            conv("project-old", { updatedAtMs: 1000 }),
            conv("project-new", { updatedAtMs: 3000 }),
            conv("project-middle", { updatedAtMs: 2000 }),
          ],
        },
      ],
      selectedId: "root-old",
    });

    const read = readWorkspaceStateFromDb(new Set<string>());

    expect(read.chats.map((conversation) => conversation.id)).toEqual(["root-new", "root-middle", "root-old"]);
    expect(read.projects[0]?.conversations.map((conversation) => conversation.id)).toEqual(["project-new", "project-middle", "project-old"]);
  });

  it("front-inserts projects without transient position collisions", () => {
    initializeWorkspaceStateInDb({ ...buildEmptyWorkspaceState(), selectedId: "" });

    applyWorkspaceDbMutations([
      { type: "upsertProject", project: { id: "p1", name: "P1", path: "/tmp/p1" }, insertAtFront: true },
      { type: "upsertProject", project: { id: "p2", name: "P2", path: "/tmp/p2" }, insertAtFront: true },
      { type: "upsertProject", project: { id: "p3", name: "P3", path: "/tmp/p3" }, insertAtFront: true },
    ]);

    expect(readWorkspaceStateFromDb().projects.map((project) => project.id)).toEqual(["p3", "p2", "p1"]);
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

  it("preserves a user-picked profile when a stale row-level run update arrives", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { agent: "gemini", profile: geminiProfile })],
      threads: { c1: [] },
      selectedId: "c1",
    });

    applyWorkspaceDbMutations([
      {
        type: "updateConversation",
        conversation: conv("c1", {
          agent: "codex",
          profile: codexProfile,
          status: "done",
          snippet: "Old Codex run finished",
          time: "12:01",
        }),
      },
    ]);

    expect(readWorkspaceStateFromDb().chats[0]).toMatchObject({
      agent: "gemini",
      profile: geminiProfile,
      status: "done",
      snippet: "Old Codex run finished",
      time: "12:01",
    });
  });

  it("applies explicit row-level profile selection mutations", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { agent: "codex", profile: codexProfile })],
      threads: { c1: [] },
      selectedId: "c1",
    });

    applyWorkspaceDbMutations([{ type: "setConversationProfile", conversationId: "c1", profile: geminiProfile }]);

    expect(readWorkspaceStateFromDb().chats[0]).toMatchObject({ agent: "gemini", profile: geminiProfile });
  });

  it("preserves a user-picked profile when a stale hot-path conversation update arrives", () => {
    initializeWorkspaceStateInDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1", { agent: "gemini", profile: geminiProfile })],
      threads: { c1: [] },
      selectedId: "c1",
    });

    updateConversationData(conv("c1", {
      agent: "codex",
      profile: codexProfile,
      status: "done",
      snippet: "Old Codex hot path finished",
      time: "12:02",
    }));

    expect(readWorkspaceStateFromDb().chats[0]).toMatchObject({
      agent: "gemini",
      profile: geminiProfile,
      status: "done",
      snippet: "Old Codex hot path finished",
      time: "12:02",
    });
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
