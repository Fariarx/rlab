import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/domain/agent-types";
import { buildEmptyWorkspaceState, type WorkspaceState } from "../src/lib/workspace-state";
import {
  applyWorkspaceDbMutations,
  closeWorkspaceDb,
  initializeWorkspaceStateInDb,
  initWorkspaceDb,
  readConversation,
  readThreadFromDb,
} from "../workspace-db";
import { sanitizeClientWorkspaceMutations } from "../vite-agents-plugin";

const conversation = (extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1",
  title: "Original",
  snippet: "old",
  time: "12:00",
  status: "done",
  agent: "codex",
  profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
  agentSessions: { codex: "session-server" },
  sessionId: "session-server",
  sessionAgent: "codex",
  ...extra,
});

const userMessage: ChatMessage = { id: "u1", role: "user", text: "question", time: "12:00" };
const agentMessage: ChatMessage = { id: "a1", role: "agent", blocks: [{ kind: "text", text: "answer" }] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rlab-client-mutations-"));
  initWorkspaceDb(join(dir, "workspace.db"));
  const state: WorkspaceState = {
    ...buildEmptyWorkspaceState(),
    chats: [conversation()],
    threads: { c1: [userMessage, agentMessage] },
  };
  initializeWorkspaceStateInDb(state);
});

afterEach(() => {
  closeWorkspaceDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("client workspace mutation sanitizer", () => {
  it("strips server-owned conversation fields from client updates", () => {
    const incoming = conversation({
      title: "Client title",
      status: "idle",
      agent: "gemini",
      profile: { agent: "gemini", model: "default", reasoning: "default", mode: "default" },
      activeRunId: "run-client",
      agentSessions: { gemini: "session-client" },
      sessionId: "session-client",
      sessionAgent: "gemini",
      pinned: true,
      pinnedOrder: 4096,
    });

    const [sanitized] = sanitizeClientWorkspaceMutations([{ type: "updateConversation", conversation: incoming }]);

    expect(sanitized).toMatchObject({
      type: "updateConversation",
      conversation: {
        title: "Client title",
        pinned: true,
        pinnedOrder: 4096,
        status: "done",
        agent: "codex",
        agentSessions: { codex: "session-server" },
        sessionId: "session-server",
        sessionAgent: "codex",
      },
    });
    expect(sanitized?.type === "updateConversation" ? sanitized.conversation.activeRunId : "wrong mutation").toBeUndefined();
  });

  it("turns client deletes into archive updates without deleting the thread", () => {
    const sanitized = sanitizeClientWorkspaceMutations([{ type: "deleteConversation", conversationId: "c1" }]);

    expect(sanitized).toHaveLength(1);
    expect(sanitized[0]).toMatchObject({ type: "updateConversation", conversation: { id: "c1", archived: true, pinned: false } });

    applyWorkspaceDbMutations(sanitized);

    expect(readConversation("c1")?.archived).toBe(true);
    expect(readThreadFromDb("c1").map((message) => message.id)).toEqual(["u1", "a1"]);
  });

  it("rejects existing conversation upserts and ordinary user-message overwrites", () => {
    expect(() => sanitizeClientWorkspaceMutations([{ type: "upsertConversation", conversation: conversation(), projectId: null }])).toThrow(
      "Client cannot upsert existing conversation c1; use updateConversation.",
    );
    expect(() =>
      sanitizeClientWorkspaceMutations([{ type: "upsertMessage", conversationId: "c1", message: { ...userMessage, text: "edited through upsert" } }]),
    ).toThrow("Client cannot overwrite existing user message u1; use restartUserTurn.");
    expect(() =>
      sanitizeClientWorkspaceMutations([{ type: "restartUserTurn", conversationId: "c1", userMessage: { ...userMessage, text: "edited through restart" } }]),
    ).not.toThrow();
  });
});
