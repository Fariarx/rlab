import type { WorkspaceMutation } from "../../../lib/workspace-mutations";
import { applyWorkspaceMutationToState } from "../../../lib/workspace-mutations";
import type { WorkspaceState } from "../../../lib/workspace-state";
import { normalizeAgentProfile, type AgentProfile, type ChatMessage, type ComposerDraft, type ConversationSummary, type Project } from "../../agent";
import { conversationPreviewSnippet } from "../../../lib/conversation-preview";
import { canceledRunStatusBlock, cloneMessageForFork, settleThreadLiveBlocks, snippetFromStateThread } from "./workspace-run-state";
import { findConversation, patchConversation, serializableEqual, workspaceConversations } from "./workspace-state-utils";

const FORK_TITLE_PREFIX_PATTERN = /^(?:Fork|Форк)(?:\s*#(\d+))?\s*:\s*(.+)$/i;

export function buildForkConversationTitle(sourceTitle: string): string {
  const trimmed = sourceTitle.trim();
  const match = FORK_TITLE_PREFIX_PATTERN.exec(trimmed);
  if (!match) {
    return `Fork #1: ${trimmed}`;
  }
  const explicitIndex = match[1] ? Number.parseInt(match[1], 10) : null;
  const nextIndex = explicitIndex && Number.isFinite(explicitIndex) ? explicitIndex + 1 : 1;
  return `Fork #${nextIndex}: ${match[2].trim()}`;
}

export interface BuildIdleConversationInput {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly time: string;
  readonly updatedAtMs: number;
  readonly profile: AgentProfile;
}

export function buildIdleConversation({ id, title, snippet, time, updatedAtMs, profile }: BuildIdleConversationInput): ConversationSummary {
  return {
    id,
    title,
    snippet,
    time,
    updatedAtMs,
    status: "idle",
    agent: profile.agent,
    profile,
  };
}

export function insertStandaloneConversationState(state: WorkspaceState, conversation: ConversationSummary, thread: readonly ChatMessage[]): WorkspaceState {
  return {
    ...state,
    chats: [conversation, ...state.chats],
    threads: { ...state.threads, [conversation.id]: [...thread] },
    selectedId: conversation.id,
  };
}

export function insertProjectConversationState(state: WorkspaceState, projectId: string, conversation: ConversationSummary, thread: readonly ChatMessage[]): WorkspaceState {
  return {
    ...state,
    projects: state.projects.map((project) => (project.id === projectId ? { ...project, conversations: [conversation, ...project.conversations] } : project)),
    threads: { ...state.threads, [conversation.id]: [...thread] },
    selectedId: conversation.id,
  };
}

export function insertProjectWithConversationState(
  state: WorkspaceState,
  project: Omit<Project, "conversations">,
  conversation: ConversationSummary,
  thread: readonly ChatMessage[],
): WorkspaceState {
  return {
    ...state,
    projects: [{ ...project, conversations: [conversation] }, ...state.projects],
    threads: { ...state.threads, [conversation.id]: [...thread] },
    selectedId: conversation.id,
  };
}

export interface CreateConversationStateInput {
  readonly id: string;
  readonly profile: AgentProfile;
  readonly snippet: string;
  readonly state: WorkspaceState;
  readonly thread: readonly ChatMessage[];
  readonly time: string;
  readonly updatedAtMs: number;
  readonly title: string;
}

export interface ConversationStateCreation {
  readonly conversation: ConversationSummary;
  readonly state: WorkspaceState;
  readonly thread: readonly ChatMessage[];
}

export function createStandaloneConversationState(input: CreateConversationStateInput): ConversationStateCreation {
  const conversation = buildIdleConversation(input);
  return {
    conversation,
    state: insertStandaloneConversationState(input.state, conversation, input.thread),
    thread: [...input.thread],
  };
}

export function createProjectConversationState(input: CreateConversationStateInput & { readonly projectId: string }): ConversationStateCreation {
  if (!input.state.projects.some((project) => project.id === input.projectId)) {
    throw new Error(`Project ${input.projectId} was not found.`);
  }
  const conversation = buildIdleConversation(input);
  return {
    conversation,
    state: insertProjectConversationState(input.state, input.projectId, conversation, input.thread),
    thread: [...input.thread],
  };
}

export interface ProjectWithConversationStateCreation extends ConversationStateCreation {
  readonly project: Omit<Project, "conversations">;
}

export function createProjectWithConversationState(
  input: CreateConversationStateInput & { readonly project: Omit<Project, "conversations"> },
): ProjectWithConversationStateCreation {
  if (input.state.projects.some((project) => project.id === input.project.id)) {
    throw new Error(`Project ${input.project.id} already exists.`);
  }
  const conversation = buildIdleConversation(input);
  return {
    conversation,
    project: input.project,
    state: insertProjectWithConversationState(input.state, input.project, conversation, input.thread),
    thread: [...input.thread],
  };
}

export interface ConversationMetadataStateResult {
  readonly conversation: ConversationSummary;
  readonly state: WorkspaceState;
}

function conversationMetadataResult(state: WorkspaceState, conversationId: string): ConversationMetadataStateResult | null {
  const conversation = findConversation(state, conversationId);
  return conversation ? { conversation, state } : null;
}

export function updateConversationProfileState(
  state: WorkspaceState,
  conversationId: string,
  profile: AgentProfile,
): ConversationMetadataStateResult | null {
  return conversationMetadataResult(patchConversation(state, conversationId, { agent: profile.agent, profile }), conversationId);
}

export function renameConversationState(state: WorkspaceState, conversationId: string, title: string): ConversationMetadataStateResult | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }
  return conversationMetadataResult(patchConversation(state, conversationId, { title: trimmed }), conversationId);
}

export function toggleConversationPinState(state: WorkspaceState, conversationId: string): ConversationMetadataStateResult | null {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return null;
  }
  return conversationMetadataResult(patchConversation(state, conversationId, { pinned: !conversation.pinned }), conversationId);
}

export function selectedConversationIdForState(state: WorkspaceState, preferredSelectedId: string): string {
  const preferred = findConversation(state, preferredSelectedId);
  if (preferred) {
    return preferred.id;
  }
  const conversations = workspaceConversations(state);
  return conversations.find((conversation) => !conversation.archived)?.id ?? conversations[0]?.id ?? "";
}

export function removeConversationState(state: WorkspaceState, conversationId: string): { readonly state: WorkspaceState; readonly selectedId: string } {
  const withoutConversation = applyWorkspaceMutationToState(state, { type: "deleteConversation", conversationId });
  const selectedId = selectedConversationIdForState(withoutConversation, state.selectedId === conversationId ? "" : state.selectedId);
  return {
    state: { ...withoutConversation, selectedId },
    selectedId,
  };
}

export interface ArchiveConversationStateResult {
  readonly conversation: ConversationSummary | null;
  readonly selectedId: string;
  readonly state: WorkspaceState;
}

export function archiveConversationState(state: WorkspaceState, conversationId: string): ArchiveConversationStateResult {
  const nextState = {
    ...patchConversation(state, conversationId, { archived: true, pinned: false, activeRunId: undefined, status: "idle" }),
    selectedId: state.selectedId === conversationId ? "" : state.selectedId,
  };
  return {
    conversation: findConversation(nextState, conversationId) ?? null,
    selectedId: nextState.selectedId,
    state: nextState,
  };
}

export interface StopRunConversationStateResult {
  readonly conversation: ConversationSummary | null;
  readonly state: WorkspaceState;
  readonly thread: readonly ChatMessage[];
}

export function stopRunConversationState(state: WorkspaceState, conversationId: string, time: string, canceledText?: string): StopRunConversationStateResult {
  const currentConversation = findConversation(state, conversationId);
  const shouldMarkCanceled = currentConversation?.status === "running" || currentConversation?.status === "waiting";
  const settled = settleThreadLiveBlocks(state, conversationId, shouldMarkCanceled && canceledText ? canceledRunStatusBlock(canceledText) : undefined);
  const conversation = findConversation(settled, conversationId);
  if (!conversation || (conversation.status !== "running" && conversation.status !== "waiting")) {
    return {
      conversation: conversation ?? null,
      state: settled,
      thread: settled.threads[conversationId] ?? [],
    };
  }

  const snippet = snippetFromStateThread(settled, conversationId);
  const nextState = patchConversation(settled, conversationId, {
    activeRunId: undefined,
    status: "idle",
    ...(snippet ? { snippet } : {}),
    time,
  });
  return {
    conversation: findConversation(nextState, conversationId) ?? null,
    state: nextState,
    thread: nextState.threads[conversationId] ?? [],
  };
}

export interface ForkConversationStateInput {
  readonly conversationId: string;
  readonly forkId: string;
  readonly forkTitle: string;
  readonly messageId: string;
  readonly nextId: (prefix: string) => string;
  readonly state: WorkspaceState;
  readonly time: string;
  readonly updatedAtMs?: number;
}

export interface ForkConversationStateResult {
  readonly conversation: ConversationSummary;
  readonly forkId: string;
  readonly projectId: string | null;
  readonly state: WorkspaceState;
  readonly thread: readonly ChatMessage[];
}

export function forkConversationState({
  conversationId,
  forkId,
  forkTitle,
  messageId,
  nextId,
  state,
  time,
  updatedAtMs,
}: ForkConversationStateInput): ForkConversationStateResult | null {
  const source = findConversation(state, conversationId);
  const sourceThread = state.threads[conversationId] ?? [];
  const messageIndex = sourceThread.findIndex((message) => message.id === messageId && message.role === "agent");
  const message = messageIndex >= 0 ? sourceThread[messageIndex] : undefined;
  if (!source || !message || message.role !== "agent") {
    return null;
  }

  const profile = normalizeAgentProfile(message.profile ?? source.profile, message.profile?.agent ?? source.agent);
  const conversation: ConversationSummary = {
    ...source,
    id: forkId,
    title: forkTitle,
    snippet: conversationPreviewSnippet([message], 60),
    time,
    updatedAtMs: updatedAtMs ?? source.updatedAtMs,
    status: "idle",
    agent: profile.agent,
    profile,
    activeRunId: undefined,
    unread: false,
    pinned: false,
    costUsd: undefined,
    usage: undefined,
    agentSessions: undefined,
    sessionId: undefined,
    sessionAgent: undefined,
  };
  const thread = sourceThread.slice(0, messageIndex + 1).map((threadMessage) => cloneMessageForFork(threadMessage, nextId));
  let projectId: string | null = null;
  const projects = state.projects.map((project) => {
    if (!project.conversations.some((item) => item.id === conversationId)) {
      return project;
    }
    projectId = project.id;
    return { ...project, conversations: [conversation, ...project.conversations] };
  });

  return {
    conversation,
    forkId,
    projectId,
    state: {
      ...state,
      chats: projectId === null ? [conversation, ...state.chats] : state.chats,
      projects,
      threads: { ...state.threads, [forkId]: thread },
      selectedId: forkId,
    },
    thread,
  };
}

export function cloneComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function putComposerDraftState(state: WorkspaceState, conversationId: string, draft: ComposerDraft): WorkspaceState {
  const nextDraft = cloneComposerDraft(draft);
  const currentDraft = state.composerDrafts[conversationId] ?? { text: "", attachments: [] };
  if (serializableEqual(currentDraft, nextDraft)) {
    return state;
  }
  return {
    ...state,
    composerDrafts: {
      ...state.composerDrafts,
      [conversationId]: nextDraft,
    },
  };
}

export function composerDraftMutation(conversationId: string, draft: ComposerDraft): WorkspaceMutation {
  return draft.text.trim().length === 0 && draft.attachments.length === 0
    ? { type: "deleteComposerDraft", conversationId }
    : { type: "setComposerDraft", conversationId, draft };
}
