import { conversationPreviewSnippet } from "../../../lib/conversation-preview";
import { finishLiveBlock } from "../../../lib/agent-block-state";
import type { WorkspaceMutation } from "../../../lib/workspace-mutations";
import { normalizeAgentProfile, type AgentBlock, type ChatMessage, type ConversationStatus, type ConversationSummary } from "../../agent";
import type { ActiveRunUpdate, RunConversationResult } from "../../../client/api/run-agent";
import { conversationProfile, findConversation, patchConversation, serializableEqual } from "./workspace-state-utils";
import type { WorkspaceState } from "../../../lib/workspace-state";

export interface RunMessageHandle {
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly serverOwned: boolean;
}

function shouldKeepLongerLiveText(previousText: string, nextText: string): boolean {
  const normalizedNext = nextText.trim();
  return previousText.length > nextText.length && (normalizedNext.length === 0 || previousText.includes(normalizedNext));
}

function mergeLiveBlockText(block: AgentBlock, previous: AgentBlock | undefined): AgentBlock {
  if (block.kind === "reasoning" && block.active && previous?.kind === "reasoning" && previous.text && shouldKeepLongerLiveText(previous.text, block.text)) {
    return { ...block, text: previous.text };
  }
  if (block.kind === "text" && block.streaming && previous?.kind === "text" && previous.text && shouldKeepLongerLiveText(previous.text, block.text)) {
    return { ...block, text: previous.text };
  }
  return block;
}

export function mergeInputBlockState(blocks: readonly AgentBlock[], previousBlocks: readonly AgentBlock[] | undefined): AgentBlock[] {
  return blocks.map((block, index) => {
    if (block.kind === "approval" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "approval" && item.id === block.id);
      return previous?.kind === "approval" && previous.decision ? { ...block, decision: previous.decision } : block;
    }
    if (block.kind === "options" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "options" && item.id === block.id);
      return previous?.kind === "options" && previous.selected ? { ...block, selected: [...previous.selected] } : block;
    }
    return mergeLiveBlockText(block, previousBlocks?.[index]);
  });
}

export function blocksNeedInput(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "approval") {
      return !block.decision;
    }
    if (block.kind === "options") {
      return !block.selected || block.selected.length === 0;
    }
    return false;
  });
}

export function blocksHaveLiveOutput(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case "reasoning":
        return block.active === true;
      case "text":
        return block.streaming === true;
      case "tool":
      case "command":
      case "search":
        return block.state === "running";
      case "plan":
        return block.steps.some((step) => step.state === "running");
      default:
        return false;
    }
  });
}

function messageHasLiveOutput(message: ChatMessage | undefined): message is ChatMessage {
  return message?.role === "agent" && blocksHaveLiveOutput(message.blocks ?? []);
}

export function withoutStaleActiveRunMessageMutations(
  state: WorkspaceState,
  runs: ReadonlyMap<string, RunMessageHandle>,
  mutations: readonly WorkspaceMutation[],
): WorkspaceMutation[] {
  const isStaleActiveRunMessageMutation = (conversationId: string, message: ChatMessage): boolean => {
    const run = runs.get(conversationId);
    if (!run?.serverOwned || run.agentMessageId !== message.id) {
      return false;
    }
    const localMessage = state.threads[conversationId]?.find((item) => item.id === message.id);
    return messageHasLiveOutput(localMessage) && !serializableEqual(localMessage, message);
  };

  const next: WorkspaceMutation[] = [];
  for (const mutation of mutations) {
    if (mutation.type === "upsertMessage" && isStaleActiveRunMessageMutation(mutation.conversationId, mutation.message)) {
      continue;
    }
    if (mutation.type === "upsertMessages") {
      const messages = mutation.messages.filter((message) => !isStaleActiveRunMessageMutation(mutation.conversationId, message));
      if (messages.length > 0) {
        next.push({ ...mutation, messages });
      }
      continue;
    }
    next.push(mutation);
  }
  return next;
}

export function preserveLiveActiveRunMessages(state: WorkspaceState, localState: WorkspaceState, runs: ReadonlyMap<string, RunMessageHandle>): WorkspaceState {
  let threads: Record<string, ChatMessage[]> | null = null;
  for (const [conversationId, run] of runs) {
    const localMessage = localState.threads[conversationId]?.find((message) => message.id === run.agentMessageId);
    if (!messageHasLiveOutput(localMessage)) {
      continue;
    }
    const currentMessages = (threads ?? state.threads)[conversationId] ?? [];
    const nextMessages = upsertAgentMessageForUserTurn(currentMessages, run.userMessageId, localMessage);
    if (!serializableEqual(currentMessages, nextMessages)) {
      threads = threads ?? { ...state.threads };
      threads[conversationId] = nextMessages;
    }
  }
  return threads ? { ...state, threads } : state;
}

/** Clears a block's "live" flags so the UI stops animating it. Used when a run
 *  is stopped or errors mid-stream; otherwise reasoning/tool blocks keep their
 *  working animation even though the agent is no longer running. */
function settleLiveBlock(block: AgentBlock): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state: "error" } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running") ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state: "error" } : step)) } : block;
    default:
      return block;
  }
}

function lastTimelineNonTextIndex(blocks: readonly AgentBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === "reasoning" || block.kind === "tool" || block.kind === "command" || block.kind === "search" || block.kind === "code") {
      return index;
    }
  }
  return -1;
}

function settleStoppedRunBlocks(blocks: readonly AgentBlock[]): AgentBlock[] {
  const lastNonText = lastTimelineNonTextIndex(blocks);
  return blocks.map((block, index) => {
    const settled = settleLiveBlock(block);
    return settled.kind === "text" && index > lastNonText ? { ...settled, result: true } : settled;
  });
}

export function settleThreadLiveBlocks(state: WorkspaceState, id: string): WorkspaceState {
  const messages = state.threads[id];
  if (!messages) {
    return state;
  }
  let changed = false;
  const next = messages.map((message) => {
    const previousBlocks = message.blocks;
    if (message.role !== "agent" || !previousBlocks) {
      return message;
    }
    const blocks = settleStoppedRunBlocks(previousBlocks);
    if (blocks.some((block, index) => block !== previousBlocks[index])) {
      changed = true;
      return { ...message, blocks };
    }
    return message;
  });
  return changed ? { ...state, threads: { ...state.threads, [id]: next } } : state;
}

export function finishThreadLiveBlocks(state: WorkspaceState, id: string, runState: "ok" | "error"): WorkspaceState {
  const messages = state.threads[id];
  if (!messages) {
    return state;
  }
  let changed = false;
  const next = messages.map((message) => {
    const previousBlocks = message.blocks;
    if (message.role !== "agent" || !previousBlocks) {
      return message;
    }
    const blocks = previousBlocks.map((block) => finishLiveBlock(block, runState));
    if (blocks.some((block, index) => block !== previousBlocks[index])) {
      changed = true;
      return { ...message, blocks };
    }
    return message;
  });
  return changed ? { ...state, threads: { ...state.threads, [id]: next } } : state;
}

function finishBlocks(blocks: readonly AgentBlock[], runState: "ok" | "error"): AgentBlock[] {
  return blocks.map((block) => finishLiveBlock(block, runState));
}

export function cloneMessageForFork(message: ChatMessage, nextId: (prefix: string) => string): ChatMessage {
  const idPrefix = message.role === "user" ? "u" : "a";
  return {
    ...message,
    id: nextId(idPrefix),
    profile: message.profile ? normalizeAgentProfile(message.profile, message.profile.agent) : undefined,
    blocks: message.blocks?.map((block) => finishLiveBlock(JSON.parse(JSON.stringify(block)) as AgentBlock, "ok")),
  };
}

export function blocksHaveStatus(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => block.kind === "status");
}

export function snippetFromStateThread(state: WorkspaceState, conversationId: string): string {
  return conversationPreviewSnippet(state.threads[conversationId] ?? [], 60);
}

type SettledRunConversationResult = RunConversationResult & { readonly status: "done" | "error" | "waiting" };

export function isSettledRunConversationResult(result: RunConversationResult): result is SettledRunConversationResult {
  return result.status !== "detached";
}

export function finalRunPatch(
  current: WorkspaceState,
  conversationId: string,
  agentMessageId: string,
  result: SettledRunConversationResult,
): Partial<ConversationSummary> {
  const agentBlocks = current.threads[conversationId]?.find((message) => message.id === agentMessageId)?.blocks;
  const inputResolved = agentBlocks !== undefined && !blocksNeedInput(agentBlocks);
  const resolvedStatus = result.status === "waiting" && inputResolved ? "done" : result.status;
  const snippet = snippetFromStateThread(current, conversationId);
  return {
    activeRunId: undefined,
    status: resolvedStatus,
    ...(snippet ? { snippet } : {}),
    ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

export function patchAgentMessageUsage(
  state: WorkspaceState,
  conversationId: string,
  agentMessageId: string,
  result: Pick<RunConversationResult, "costUsd" | "usage">,
): WorkspaceState {
  if (result.costUsd === undefined && result.usage === undefined) {
    return state;
  }
  const messages = state.threads[conversationId];
  if (!messages?.some((message) => message.id === agentMessageId)) {
    return state;
  }
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: messages.map((message) =>
        message.id === agentMessageId
          ? {
              ...message,
              ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
              ...(result.usage === undefined ? {} : { usage: result.usage }),
            }
          : message,
      ),
    },
  };
}

export function upsertAgentMessageForUserTurn(messages: readonly ChatMessage[], userMessageId: string, message: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  const withoutCurrent = messages.filter((item) => item.id !== message.id);
  const userIndex = withoutCurrent.findIndex((item) => item.id === userMessageId && item.role === "user");
  if (userIndex < 0) {
    return existingIndex >= 0 ? messages.map((item) => (item.id === message.id ? message : item)) : [...messages, message];
  }
  const nextUserIndex = withoutCurrent.findIndex((item, index) => index > userIndex && item.role === "user");
  const staleReplyEnd = nextUserIndex < 0 ? withoutCurrent.length : nextUserIndex;
  const before = withoutCurrent.slice(0, userIndex + 1);
  const after = withoutCurrent.slice(staleReplyEnd);
  return [...before, message, ...after];
}

export function isLiveRunStatus(status: ConversationStatus): boolean {
  return status === "running" || status === "waiting";
}

export function patchActiveRunUpdate(state: WorkspaceState, update: ActiveRunUpdate): WorkspaceState {
  const messages = state.threads[update.conversationId] ?? [];
  const previousMessage = messages.find((message) => message.id === update.agentMessageId);
  const previousBlocks = previousMessage?.blocks;
  const profile = previousMessage?.profile ?? conversationProfile(findConversation(state, update.conversationId));
  const mergedBlocks = mergeInputBlockState(update.blocks, previousBlocks);
  const blocks = update.done || !isLiveRunStatus(update.status) ? finishBlocks(mergedBlocks, update.status === "error" || update.status === "idle" ? "error" : "ok") : mergedBlocks;
  const message: ChatMessage = {
    id: update.agentMessageId,
    role: "agent",
    time: update.time,
    ...(update.startedAtMs === undefined ? {} : { startedAtMs: update.startedAtMs }),
    profile,
    blocks,
    ...(update.costUsd === undefined ? {} : { costUsd: update.costUsd }),
    ...(update.usage === undefined ? {} : { usage: update.usage }),
  };
  const threads = {
    ...state.threads,
    [update.conversationId]: upsertAgentMessageForUserTurn(messages, update.userMessageId, message),
  };
  const nextState = { ...state, threads };
  const snippet = snippetFromStateThread(nextState, update.conversationId);
  return patchConversation(nextState, update.conversationId, {
    activeRunId: update.done || !isLiveRunStatus(update.status) ? undefined : update.runId,
    status: update.status,
    ...(snippet ? { snippet } : {}),
    time: update.time,
    ...(update.costUsd === undefined ? {} : { costUsd: update.costUsd }),
    ...(update.usage === undefined ? {} : { usage: update.usage }),
  });
}
