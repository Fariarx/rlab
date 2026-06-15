import { translate } from "../../../i18n/I18nProvider";
import {
  normalizeAgentProfile,
  type AgentId,
  type AgentProfile,
  type ApprovalDecision,
  type ChatMessage,
  type ConversationSummary,
  type Project,
} from "../../agent";
import type { WorkspaceState } from "../../../lib/workspace-state";

export function findConversation(state: WorkspaceState, id: string): ConversationSummary | null {
  return [...state.chats, ...state.projects.flatMap((p) => p.conversations)].find((c) => c.id === id) ?? null;
}

export function workspaceConversations(state: WorkspaceState): ConversationSummary[] {
  return [...state.chats, ...state.projects.flatMap((project) => project.conversations)];
}

export function projectMeta(project: Project): Omit<Project, "conversations"> {
  const { conversations: _conversations, ...meta } = project;
  return meta;
}

export function projectIdForConversation(state: WorkspaceState, conversationId: string): string | null {
  return state.projects.find((project) => project.conversations.some((conversation) => conversation.id === conversationId))?.id ?? null;
}

/** The attachment-block portion of a sent user message (inline text-file blocks
 *  and path-based file links), so editing+resending keeps the attachments. */
export function extractAttachmentBlocks(text: string): string {
  const blocks: string[] = [];
  for (const match of text.matchAll(/<attachment\s+name="[^"]*"[^>]*>[\s\S]*?<\/attachment>/g)) {
    blocks.push(match[0]);
  }
  for (const match of text.matchAll(/!?\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? "";
    if (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target)) {
      blocks.push(match[0]);
    }
  }
  return blocks.join("\n\n");
}

export function serializableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function conversationProfile(conversation: ConversationSummary | null | undefined): AgentProfile {
  return normalizeAgentProfile(conversation?.profile, conversation?.agent ?? "claude-code");
}

/** A lean transcript line for one message: the user's text, or the agent's
 *  answer (text/code blocks only; reasoning and tool noise are omitted). */
function messageTranscriptText(message: ChatMessage): string {
  if (message.role === "user") {
    return (message.text ?? "").trim();
  }
  return (message.blocks ?? [])
    .map((block) => (block.kind === "text" ? block.text : block.kind === "code" ? block.code : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Builds the agent prompt from the conversation so far. Each agent run is a
 *  fresh, stateless invocation (no session/resume), so prior turns must be
 *  replayed in the prompt or the agent loses the thread. First message in a
 *  conversation uses only the current text. */
export function buildAgentPrompt(priorMessages: readonly ChatMessage[], currentText: string): string {
  const turns = priorMessages
    .map((message) => {
      const content = messageTranscriptText(message);
      return content ? `${message.role === "user" ? "User" : "Assistant"}: ${content}` : null;
    })
    .filter((line): line is string => line !== null);
  if (turns.length === 0) {
    return currentText;
  }
  return `This is a continuing conversation; here are the earlier turns for context:\n\n${turns.join("\n\n")}\n\n---\n\nUser: ${currentText}`;
}

/** The project's base working directory (ignores any worktree override). */
export function conversationBasePath(state: WorkspaceState, id: string): string | undefined {
  return state.projects.find((p) => p.conversations.some((c) => c.id === id))?.path;
}

/** The directory the agent/Git view actually operate in: an isolated worktree
 *  when one is attached to the conversation, otherwise the project base path. */
export function conversationCwd(state: WorkspaceState, id: string): string | undefined {
  return findConversation(state, id)?.worktreePath ?? conversationBasePath(state, id);
}

export function patchConversation(state: WorkspaceState, id: string, patch: Partial<ConversationSummary>): WorkspaceState {
  // Any patch that refreshes the display time is an activity beat, so bump the
  // recency key that drives newest→oldest sidebar ordering (unless the caller
  // already set one explicitly).
  const stamped = patch.time !== undefined && patch.updatedAtMs === undefined ? { ...patch, updatedAtMs: Date.now() } : patch;
  return {
    ...state,
    chats: state.chats.map((c) => (c.id === id ? { ...c, ...stamped } : c)),
    projects: state.projects.map((p) => ({
      ...p,
      conversations: p.conversations.map((c) => (c.id === id ? { ...c, ...stamped } : c)),
    })),
  };
}

export function conversationSessionId(conversation: ConversationSummary | null | undefined, agent: AgentId): string | undefined {
  return conversation?.agentSessions?.[agent] ?? (conversation?.sessionAgent === agent ? conversation.sessionId : undefined);
}

export function patchConversationAgentSession(state: WorkspaceState, id: string, agent: AgentId, sessionId: string): WorkspaceState {
  const conversation = findConversation(state, id);
  const agentSessions: Partial<Record<AgentId, string>> = { ...(conversation?.agentSessions ?? {}), [agent]: sessionId };
  return patchConversation(state, id, { agentSessions, sessionId, sessionAgent: agent });
}

export function patchApprovalDecision(state: WorkspaceState, conversationId: string, approvalId: string, decision: ApprovalDecision): WorkspaceState {
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: (state.threads[conversationId] ?? []).map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => (block.kind === "approval" && block.id === approvalId ? { ...block, decision } : block)),
      })),
    },
  };
}

export function patchOptionSelection(state: WorkspaceState, conversationId: string, optionBlockId: string, selectedLabels: readonly string[]): WorkspaceState {
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: (state.threads[conversationId] ?? []).map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => (block.kind === "options" && block.id === optionBlockId ? { ...block, selected: [...selectedLabels] } : block)),
      })),
    },
  };
}

export function projectIdFromName(name: string): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Project name must contain letters or numbers.");
  }
  return id;
}

export function isDefaultConversationTitle(title: string | undefined): boolean {
  return title === undefined || title === translate("en", "newChat") || title === translate("ru", "newChat");
}
