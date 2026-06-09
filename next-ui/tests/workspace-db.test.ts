import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/components/agent/types";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";
import {
  closeWorkspaceDb,
  initWorkspaceDb,
  readConversation,
  readMessageBlocks,
  readThreadFromDb,
  readWorkspaceStateFromDb,
  updateConversationData,
  upsertAgentMessageForUserTurn,
  upsertMessage,
  workspaceDbHasState,
  writeWorkspaceShellPreservingThreads,
  writeWorkspaceStateToDb,
} from "../workspace-db";

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
    writeWorkspaceStateToDb(state);
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
    writeWorkspaceStateToDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1", { status: "running" })], threads: { c1: [] }, selectedId: "c1" });

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
    expect(after.chats[0].snippet).toBe("answer");
    expect(after.threads.c1).toHaveLength(2);
  });

  it("upserts a bound agent reply after its user turn and deletes stale replies", () => {
    writeWorkspaceStateToDb({
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
    writeWorkspaceStateToDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1")],
      threads: { c1: [userMsg("u1", "first"), userMsg("u2", "second")] },
      selectedId: "c1",
    });

    upsertAgentMessageForUserTurn("c1", "u1", msg("a1", "answer"));

    expect(readThreadFromDb("c1").map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("rejects a bound agent reply when the user turn is missing", () => {
    writeWorkspaceStateToDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1")], threads: { c1: [msg("a1", "answer")] }, selectedId: "c1" });

    expect(() => upsertAgentMessageForUserTurn("c1", "u-missing", msg("a-new", "new answer"))).toThrow("User message u-missing is missing");
  });

  it("filtered read loads only the requested threads; readThreadFromDb loads one", () => {
    writeWorkspaceStateToDb({ ...buildEmptyWorkspaceState(), chats: [conv("c1"), conv("c2")], threads: { c1: [msg("m1", "a")], c2: [msg("m2", "b")] }, selectedId: "c1" });
    const shell = readWorkspaceStateFromDb(new Set(["c1"]));
    expect(shell.threads.c1).toHaveLength(1);
    expect(shell.threads.c2).toBeUndefined();
    expect(readThreadFromDb("c2").map((m) => m.id)).toEqual(["m2"]);
  });

  it("partial shell write preserves unsent threads, replaces sent ones, drops deleted convs", () => {
    writeWorkspaceStateToDb({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1"), conv("c2"), conv("c3")],
      threads: { c1: [msg("m1", "a")], c2: [msg("m2", "b")], c3: [msg("m3", "c")] },
      selectedId: "c1",
    });
    // Client holds only c1 (loaded), leaves c2 lazy (absent), and deletes c3.
    writeWorkspaceShellPreservingThreads({
      ...buildEmptyWorkspaceState(),
      chats: [conv("c1"), conv("c2")],
      threads: { c1: [msg("m1", "a2"), msg("m1b", "x")] },
      selectedId: "c1",
    });
    const read = readWorkspaceStateFromDb();
    expect(read.chats.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(read.threads.c1.map((m) => m.id)).toEqual(["m1", "m1b"]); // replaced
    expect(read.threads.c2.map((m) => m.id)).toEqual(["m2"]); // preserved (lazy, not sent)
    expect(read.threads.c3).toBeUndefined(); // deleted conversation → messages dropped
  });
});
