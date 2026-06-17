import { describe, expect, it } from "vitest";
import type { ChatMessage, ConversationSummary } from "../src/components/agent";
import {
  appendCompactionRequestState,
  appendThreadMessageState,
  appendUserMessageState,
  appendUserMessageTurnState,
  applyUserTurnSelectionState,
  cleanCompactionSettings,
  decideApprovalState,
  editUserTurn,
  patchConversationCompactionState,
  promptForUserTurn,
  retryUserTurn,
  selectOptionsState,
} from "../src/components/workspace/models/workspace-thread-actions-model";
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

function agentMessage(id: string, text = id): ChatMessage {
  return { id, role: "agent", time: "12:01", blocks: [{ kind: "text", text }] };
}

function agentInputMessage(): ChatMessage {
  return {
    id: "a-input",
    role: "agent",
    time: "12:01",
    blocks: [
      { kind: "approval", id: "approval-1", title: "Run command" },
      {
        kind: "options",
        id: "options-1",
        prompt: "Pick",
        options: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      },
    ],
  };
}

function workspace(patch: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...buildEmptyWorkspaceState(),
    ...patch,
  };
}

describe("workspace-thread-actions-model", () => {
  it("appends user and review-style messages to conversation threads", () => {
    const archived = conversation("chat-1", { archived: true });
    const state = workspace({
      chats: [archived],
      threads: { "chat-1": [userMessage("u1")] },
    });

    const withUser = appendUserMessageState(state, "chat-1", userMessage("u2"));
    expect(withUser.chats[0]?.archived).toBe(false);
    expect(withUser.threads["chat-1"]?.map((message) => message.id)).toEqual(["u1", "u2"]);

    const withReview = appendThreadMessageState(withUser, "chat-1", { id: "review", role: "user", blocks: [{ kind: "review", comments: [] }] });
    expect(withReview.threads["chat-1"]?.map((message) => message.id)).toEqual(["u1", "u2", "review"]);
  });

  it("returns the updated conversation when appending a user turn", () => {
    const state = workspace({
      chats: [conversation("chat-1", { archived: true })],
      threads: { "chat-1": [userMessage("u1")] },
    });

    const result = appendUserMessageTurnState(state, "chat-1", userMessage("u2"));

    expect(result.conversation).toMatchObject({ id: "chat-1", archived: false });
    expect(result.state.threads["chat-1"]?.map((message) => message.id)).toEqual(["u1", "u2"]);
    expect(result.state.chats[0]).toBe(result.conversation);
  });

  it("cleans and applies compaction settings", () => {
    expect(cleanCompactionSettings({ auto: true, window: 0 })).toBeUndefined();
    expect(cleanCompactionSettings({ auto: false, window: -1 })).toEqual({ auto: false });
    expect(cleanCompactionSettings({ auto: true, window: 12_000 })).toEqual({ window: 12_000 });

    const state = workspace({ chats: [conversation("chat-1", { compaction: { auto: false, window: 8_000 } })] });
    expect(patchConversationCompactionState(state, "chat-1", { auto: true, window: undefined }).chats[0]?.compaction).toBeUndefined();
    expect(patchConversationCompactionState(state, "chat-1", { window: 16_000 }).chats[0]?.compaction).toEqual({ auto: false, window: 16_000 });
  });

  it("appends compaction requests and resets context usage", () => {
    const state = workspace({
      chats: [conversation("chat-1", { usage: { totalTokens: 100, contextTokens: 90 } })],
      threads: { "chat-1": [userMessage("u1")] },
    });

    const next = appendCompactionRequestState(state, "chat-1", userMessage("compact", "Compact context"));

    expect(next.chats[0]?.usage).toEqual({ totalTokens: 100, contextTokens: 0 });
    expect(next.threads["chat-1"]?.map((message) => message.id)).toEqual(["u1", "compact"]);
  });

  it("records approval decisions and marks the conversation running", () => {
    const state = workspace({
      chats: [conversation("chat-1", { status: "waiting", time: "12:00" })],
      threads: { "chat-1": [agentInputMessage()] },
    });

    const result = decideApprovalState(state, "chat-1", "approval-1", "approved", "13:00");

    expect(result.conversation).toMatchObject({ id: "chat-1", status: "running", time: "13:00" });
    expect(result.thread[0]?.blocks?.[0]).toMatchObject({ kind: "approval", id: "approval-1", decision: "approved" });
    expect(result.state.chats[0]).toBe(result.conversation);
    expect(result.state.threads["chat-1"]).toBe(result.thread);
  });

  it("records option selections with an isolated selected-label array", () => {
    const selectedLabels = ["One"];
    const state = workspace({
      chats: [conversation("chat-1", { status: "waiting", time: "12:00" })],
      threads: { "chat-1": [agentInputMessage()] },
    });

    const result = selectOptionsState(state, "chat-1", "options-1", selectedLabels, "13:00");

    selectedLabels.push("Two");
    expect(result.conversation).toMatchObject({ id: "chat-1", status: "running", time: "13:00" });
    expect(result.thread[0]?.blocks?.[1]).toMatchObject({ kind: "options", id: "options-1", selected: ["One"] });
  });

  it("selects the user turn to retry and truncates stale replies", () => {
    const thread = [userMessage("u1", "first"), agentMessage("a1"), userMessage("u2", "second"), agentMessage("a2")];

    expect(retryUserTurn(thread, "a2")).toEqual({ userMsg: thread[2], thread: thread.slice(0, 3) });
    expect(retryUserTurn(thread, "u1")).toEqual({ userMsg: thread[0], thread: thread.slice(0, 1) });
    expect(retryUserTurn(thread, "missing")).toBeNull();
  });

  it("applies selected user turns to workspace thread state", () => {
    const state = workspace({
      chats: [conversation("chat-1")],
      threads: { "chat-1": [userMessage("stale")] },
    });
    const selection = { userMsg: userMessage("u1"), thread: [userMessage("u1"), agentMessage("a1")] };

    const result = applyUserTurnSelectionState(state, "chat-1", selection);

    expect(result.userMsg).toBe(selection.userMsg);
    expect(result.thread).toEqual(selection.thread);
    expect(result.thread).not.toBe(selection.thread);
    expect(result.state.threads["chat-1"]).toBe(result.thread);
  });

  it("edits a user turn from the submitted payload without duplicating old attachments", () => {
    const originalText = 'Old text\n\n<attachment name="note.txt">hello</attachment>\n\n![image](C:/tmp/shot.png)';
    const thread = [userMessage("u1", originalText), agentMessage("a1")];
    const editedText = 'New text\n\n<attachment name="note.txt">hello</attachment>\n\n![image](C:/tmp/shot.png)';

    const selection = editUserTurn(thread, "u1", `  ${editedText}  `, "13:00");

    expect(selection?.thread.map((message) => message.id)).toEqual(["u1"]);
    expect(selection?.userMsg).toMatchObject({
      id: "u1",
      role: "user",
      time: "13:00",
      text: editedText,
    });
    expect(selection?.userMsg.text?.match(/<attachment name="note\.txt">/g)).toHaveLength(1);
    expect(selection?.userMsg.text?.match(/!\[image\]\(C:\/tmp\/shot\.png\)/g)).toHaveLength(1);
    expect(editUserTurn(thread, "u1", "New text without attachments", "13:00")?.userMsg.text).toBe("New text without attachments");
    expect(editUserTurn(thread, "u1", "   ", "13:00")).toBeNull();
    expect(editUserTurn(thread, "missing", "New", "13:00")).toBeNull();
  });

  it("builds run prompts from overrides, resumed sessions, or prior transcript", () => {
    const thread = [userMessage("u1", "first"), agentMessage("a1", "answer"), userMessage("u2", "second")];

    expect(promptForUserTurn(thread, thread[2], false, "override")).toBe("override");
    expect(promptForUserTurn(thread, thread[2], true, undefined)).toBe("second");
    expect(promptForUserTurn(thread, thread[2], false, undefined)).toContain("User: first");
    expect(promptForUserTurn(thread, thread[2], false, undefined)).toContain("Assistant: answer");
    expect(promptForUserTurn(thread, thread[2], false, undefined)).toContain("User: second");
  });
});
