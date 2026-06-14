import type { WorkspaceState } from "./workspace-state";

let workspaceIdSeq = 1000;

export function nextWorkspaceId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${++workspaceIdSeq}-${Date.now().toString(36)}`;
}

export function generatedWorkspaceIdSequence(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = /^(?:chat|u|a|run)-(\d+)/.exec(value);
  return match ? Number(match[1]) : 0;
}

export function syncGeneratedWorkspaceIdSequence(state: WorkspaceState): void {
  const conversations = [
    ...state.chats,
    ...state.projects.flatMap((project) => project.conversations),
  ];
  const messageIds = Object.values(state.threads).flatMap((messages) => messages.map((message) => message.id));
  const activeRunIds = conversations.map((conversation) => conversation.activeRunId);
  const max = Math.max(
    0,
    ...conversations.map((conversation) => generatedWorkspaceIdSequence(conversation.id)),
    ...messageIds.map(generatedWorkspaceIdSequence),
    ...activeRunIds.map(generatedWorkspaceIdSequence),
  );
  workspaceIdSeq = Math.max(workspaceIdSeq, max);
}
