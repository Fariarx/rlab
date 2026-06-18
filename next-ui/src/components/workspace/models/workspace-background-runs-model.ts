import type { ChatMessage } from "../../agent";
import { conversationPreviewSnippet } from "../../../lib/conversation-preview";
import type { WorkspaceState } from "../../../lib/workspace-state";
import { isLiveRunStatus, settleThreadLiveBlocks } from "./workspace-run-state";
import { findConversation, patchConversation, serializableEqual, workspaceConversations } from "./workspace-state-utils";

export function hasUntrackedPersistedActiveRuns(state: WorkspaceState, trackedRuns: ReadonlyMap<string, unknown>): boolean {
  return workspaceConversations(state).some(
    (conversation) => Boolean(conversation.activeRunId) && !trackedRuns.has(conversation.id) && isLiveRunStatus(conversation.status),
  );
}

export interface MergeBackgroundRunStateInput {
  readonly current: WorkspaceState;
  readonly loaded: WorkspaceState;
  readonly activeRunIds: ReadonlySet<string>;
  readonly trackedRuns: ReadonlyMap<string, unknown>;
}

export function mergeBackgroundRunState({ current, loaded, activeRunIds, trackedRuns }: MergeBackgroundRunStateInput): WorkspaceState {
  const ids = new Set(
    workspaceConversations(current)
      .filter((conversation) => Boolean(conversation.activeRunId) && !trackedRuns.has(conversation.id))
      .map((conversation) => conversation.id),
  );
  if (ids.size === 0) {
    return current;
  }
  let next = current;
  let threads: Record<string, ChatMessage[]> | null = null;
  for (const id of ids) {
    const loadedConversation = findConversation(loaded, id);
    if (!loadedConversation) {
      continue;
    }
    const currentConversation = findConversation(next, id);
    const loadedThread = loaded.threads[id] ?? current.threads[id] ?? [];
    if (
      currentConversation?.activeRunId &&
      !activeRunIds.has(currentConversation.activeRunId) &&
      loadedConversation.activeRunId === currentConversation.activeRunId &&
      isLiveRunStatus(loadedConversation.status)
    ) {
      const snippet = conversationPreviewSnippet(loadedThread, 60);
      next = patchConversation(settleThreadLiveBlocks(next, id), id, {
        activeRunId: undefined,
        status: "error",
        ...(snippet ? { snippet } : {}),
      });
      continue;
    }
    if (!serializableEqual(currentConversation, loadedConversation)) {
      next = patchConversation(next, id, loadedConversation);
    }
    const currentThread = current.threads[id] ?? [];
    const currentThreadUpdatedAtMs = currentConversation?.threadUpdatedAtMs;
    const loadedThreadUpdatedAtMs = loadedConversation.threadUpdatedAtMs;
    const threadChanged =
      currentThread !== loadedThread &&
      (currentThreadUpdatedAtMs === undefined || loadedThreadUpdatedAtMs === undefined
        ? !serializableEqual(currentThread, loadedThread)
        : currentThreadUpdatedAtMs !== loadedThreadUpdatedAtMs || currentThread.length !== loadedThread.length);
    if (threadChanged) {
      threads = threads ?? { ...current.threads };
      threads[id] = loadedThread;
    }
  }
  return threads ? { ...next, threads } : next;
}
