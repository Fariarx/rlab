import type { ApprovalDecision, ChatMessage, CompactionSettings, ConversationSummary } from "../../agent";
export { promptForUserTurn } from "../../../lib/agent-prompt";
import type { WorkspaceState } from "../../../lib/workspace-state";
import {
  findConversation,
  patchApprovalDecision,
  patchConversation,
  patchOptionSelection,
} from "./workspace-state-utils";

export function appendUserMessageState(state: WorkspaceState, conversationId: string, message: ChatMessage): WorkspaceState {
  const updatedAtMs = typeof message.createdAtMs === "number" && Number.isFinite(message.createdAtMs) ? message.createdAtMs : undefined;
  return patchConversation(
    {
      ...state,
      threads: { ...state.threads, [conversationId]: [...(state.threads[conversationId] ?? []), message] },
    },
    conversationId,
    {
      archived: false,
      ...(message.time === undefined ? {} : { time: message.time }),
      ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
    },
  );
}

export interface AppendUserMessageStateResult {
  readonly conversation: ConversationSummary | null;
  readonly state: WorkspaceState;
}

export function appendUserMessageTurnState(state: WorkspaceState, conversationId: string, message: ChatMessage): AppendUserMessageStateResult {
  const nextState = appendUserMessageState(state, conversationId, message);
  return {
    conversation: findConversation(nextState, conversationId) ?? null,
    state: nextState,
  };
}

export function appendThreadMessageState(state: WorkspaceState, conversationId: string, message: ChatMessage): WorkspaceState {
  return {
    ...state,
    threads: { ...state.threads, [conversationId]: [...(state.threads[conversationId] ?? []), message] },
  };
}

export function cleanCompactionSettings(settings: CompactionSettings): CompactionSettings | undefined {
  const cleaned: CompactionSettings = {
    ...(settings.auto === false ? { auto: false } : {}),
    ...(typeof settings.window === "number" && settings.window > 0 ? { window: settings.window } : {}),
  };
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function patchConversationCompactionState(state: WorkspaceState, conversationId: string, patch: Partial<CompactionSettings>): WorkspaceState {
  const merged: CompactionSettings = { ...(findConversation(state, conversationId)?.compaction ?? {}), ...patch };
  return patchConversation(state, conversationId, { compaction: cleanCompactionSettings(merged) });
}

export function appendCompactionRequestState(state: WorkspaceState, conversationId: string, message: ChatMessage): WorkspaceState {
  return {
    ...state,
    chats: state.chats.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, usage: { ...(conversation.usage ?? {}), contextTokens: 0 } } : conversation,
    ),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, usage: { ...(conversation.usage ?? {}), contextTokens: 0 } } : conversation,
      ),
    })),
    threads: { ...state.threads, [conversationId]: [...(state.threads[conversationId] ?? []), message] },
  };
}

export interface AgentInputResponseStateResult {
  readonly conversation: ConversationSummary | null;
  readonly state: WorkspaceState;
  readonly thread: readonly ChatMessage[];
}

function applyAgentInputResponseState(conversationId: string, nextState: WorkspaceState): AgentInputResponseStateResult {
  return {
    conversation: findConversation(nextState, conversationId) ?? null,
    state: nextState,
    thread: nextState.threads[conversationId] ?? [],
  };
}

export function decideApprovalState(
  state: WorkspaceState,
  conversationId: string,
  approvalId: string,
  decision: ApprovalDecision,
  time: string,
): AgentInputResponseStateResult {
  return applyAgentInputResponseState(
    conversationId,
    patchConversation(patchApprovalDecision(state, conversationId, approvalId, decision), conversationId, { status: "running", time }),
  );
}

export function selectOptionsState(
  state: WorkspaceState,
  conversationId: string,
  optionBlockId: string,
  selectedLabels: readonly string[],
  time: string,
): AgentInputResponseStateResult {
  return applyAgentInputResponseState(
    conversationId,
    patchConversation(patchOptionSelection(state, conversationId, optionBlockId, selectedLabels), conversationId, { status: "running", time }),
  );
}

export interface UserTurnSelection {
  readonly userMsg: ChatMessage;
  readonly thread: ChatMessage[];
}

export interface UserTurnSelectionStateResult extends UserTurnSelection {
  readonly state: WorkspaceState;
}

export function applyUserTurnSelectionState(state: WorkspaceState, conversationId: string, selection: UserTurnSelection): UserTurnSelectionStateResult {
  const thread = [...selection.thread];
  return {
    state: {
      ...state,
      threads: {
        ...state.threads,
        [conversationId]: thread,
      },
    },
    thread,
    userMsg: selection.userMsg,
  };
}

export function retryUserTurn(thread: readonly ChatMessage[], messageId: string, time?: string, createdAtMs?: number): UserTurnSelection | null {
  const target = thread.findIndex((message) => message.id === messageId);
  if (target < 0) {
    return null;
  }
  let userIndex = -1;
  for (let cursor = target; cursor >= 0; cursor -= 1) {
    if (thread[cursor]?.role === "user") {
      userIndex = cursor;
      break;
    }
  }
  if (userIndex < 0) {
    return null;
  }
  const userMsg = thread[userIndex];
  if (userMsg?.role !== "user") {
    return null;
  }
  const retriedUserMsg: ChatMessage = {
    ...userMsg,
    ...(time === undefined ? {} : { time }),
    ...(createdAtMs === undefined ? {} : { createdAtMs }),
  };
  return {
    userMsg: retriedUserMsg,
    thread: [...thread.slice(0, userIndex), retriedUserMsg],
  };
}

export function editUserTurn(thread: readonly ChatMessage[], messageId: string, text: string, time: string, createdAtMs?: number): UserTurnSelection | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const index = thread.findIndex((message) => message.role === "user" && message.id === messageId);
  if (index < 0) {
    return null;
  }
  const previous = thread[index];
  if (previous?.role !== "user") {
    return null;
  }
  const userMsg: ChatMessage = { ...previous, text: trimmed, time, ...(createdAtMs === undefined ? {} : { createdAtMs }) };
  return {
    userMsg,
    thread: [...thread.slice(0, index), userMsg],
  };
}
