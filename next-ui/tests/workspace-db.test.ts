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
  readWorkspaceStateFromDb,
  updateConversationData,
  upsertMessage,
  workspaceDbHasState,
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
});
