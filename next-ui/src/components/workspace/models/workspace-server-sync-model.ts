import type { ChatMessage } from "../../agent";
import type { WorkspaceState } from "../../../lib/workspace-state";
import type { RunMessageHandle } from "./workspace-run-state";
import { preserveLiveActiveRunMessages } from "./workspace-run-state";
import { findConversation, workspaceConversations } from "./workspace-state-utils";

export function selectedConversationIdAfterRemoteSync(state: WorkspaceState, preferredSelectedId: string): string {
  const preferred = findConversation(state, preferredSelectedId);
  if (preferred && !preferred.archived) {
    return preferred.id;
  }
  const serverSelected = findConversation(state, state.selectedId);
  if (serverSelected && !serverSelected.archived) {
    return serverSelected.id;
  }
  const conversations = workspaceConversations(state);
  return conversations.find((conversation) => !conversation.archived)?.id ?? conversations[0]?.id ?? "";
}

export interface MergeRemoteWorkspaceShellInput {
  readonly current: WorkspaceState;
  readonly serverState: WorkspaceState;
  readonly preferredSelectedId: string;
  readonly activeRuns: ReadonlyMap<string, RunMessageHandle>;
}

export interface RemoteWorkspaceShellMerge {
  readonly state: WorkspaceState;
  readonly selectedId: string;
  readonly knownConversationIds: ReadonlySet<string>;
  readonly shellThreadIds: ReadonlySet<string>;
}

export function mergeRemoteWorkspaceShell({ current, serverState, preferredSelectedId, activeRuns }: MergeRemoteWorkspaceShellInput): RemoteWorkspaceShellMerge {
  const selectedId = selectedConversationIdAfterRemoteSync(serverState, preferredSelectedId);
  const knownConversationIds = new Set(workspaceConversations(serverState).map((conversation) => conversation.id));
  const shellThreadIds = new Set(Object.keys(serverState.threads));
  const threads: Record<string, ChatMessage[]> = {};
  for (const [id, messages] of Object.entries(current.threads)) {
    if (knownConversationIds.has(id)) {
      threads[id] = messages;
    }
  }
  for (const [id, messages] of Object.entries(serverState.threads)) {
    if (knownConversationIds.has(id)) {
      threads[id] = messages;
    }
  }

  return {
    state: preserveLiveActiveRunMessages({ ...serverState, selectedId, threads }, current, activeRuns),
    selectedId,
    knownConversationIds,
    shellThreadIds,
  };
}

export function mergeLoadedThread(current: WorkspaceState, conversationId: string, loadedMessages: readonly ChatMessage[]): WorkspaceState {
  const existing = current.threads[conversationId] ?? [];
  const fetchedIds = new Set(loadedMessages.map((message) => message.id));
  const firstLoadedId = loadedMessages[0]?.id;
  const firstLoadedIndex = firstLoadedId ? existing.findIndex((message) => message.id === firstLoadedId) : -1;
  const prefix = firstLoadedIndex > 0 ? existing.slice(0, firstLoadedIndex).filter((message) => !fetchedIds.has(message.id)) : [];
  const suffixSource = firstLoadedIndex >= 0 ? existing.slice(firstLoadedIndex) : existing;
  const suffix = suffixSource.filter((message) => !fetchedIds.has(message.id));
  return {
    ...current,
    threads: {
      ...current.threads,
      [conversationId]: [...prefix, ...loadedMessages, ...suffix],
    },
  };
}

export function prependLoadedThreadPage(current: WorkspaceState, conversationId: string, olderMessages: readonly ChatMessage[]): WorkspaceState {
  if (olderMessages.length === 0) {
    return current;
  }
  const existing = current.threads[conversationId] ?? [];
  const existingIds = new Set(existing.map((message) => message.id));
  const prepend = olderMessages.filter((message) => !existingIds.has(message.id));
  if (prepend.length === 0) {
    return current;
  }
  return {
    ...current,
    threads: {
      ...current.threads,
      [conversationId]: [...prepend, ...existing],
    },
  };
}
