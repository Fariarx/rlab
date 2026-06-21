import type { AgentBlock, ChatMessage } from "../../agent";
import type { WorkspaceState } from "../../../lib/workspace-state";
import {
  blocksHaveLiveOutput,
  blocksHaveStatus,
  blocksNeedInput,
  mergeInputBlockState,
  snippetFromStateThread,
  upsertAgentMessageForUserTurn,
} from "./workspace-run-state";
import { patchConversation } from "./workspace-state-utils";

export interface ApplyWorkspaceAgentBlocksInput {
  readonly agentMessage: ChatMessage;
  readonly blocks: readonly AgentBlock[];
  readonly canceled: boolean;
  readonly conversationId: string;
  readonly serverOwned: boolean;
  readonly state: WorkspaceState;
  readonly userMessageId: string;
}

export interface WorkspaceAgentBlocksUpdate {
  readonly message: ChatMessage;
  readonly shouldFlush: boolean;
  readonly shouldPersistBlocks: boolean;
  readonly state: WorkspaceState;
}

export function applyWorkspaceAgentBlocks({
  agentMessage,
  blocks,
  canceled,
  conversationId,
  serverOwned,
  state,
  userMessageId,
}: ApplyWorkspaceAgentBlocksInput): WorkspaceAgentBlocksUpdate {
  const thread = state.threads[conversationId] ?? [];
  const previousBlocks = thread.find((message) => message.id === agentMessage.id)?.blocks;
  const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
  const needsInput = blocksNeedInput(mergedBlocks);
  const shouldPersistBlocks = !(serverOwned && !needsInput && blocksHaveLiveOutput(mergedBlocks));
  const shouldFlush = needsInput || blocksHaveStatus(mergedBlocks);
  const message: ChatMessage = { ...agentMessage, blocks: mergedBlocks };
  const nextState = {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: upsertAgentMessageForUserTurn(thread, userMessageId, message),
    },
  };

  if (canceled || !needsInput) {
    return { message, shouldFlush, shouldPersistBlocks, state: nextState };
  }

  const snippet = snippetFromStateThread(nextState, conversationId);
  return {
    message,
    shouldFlush,
    shouldPersistBlocks,
    state: patchConversation(nextState, conversationId, { status: "waiting", ...(snippet ? { snippet } : {}) }),
  };
}
