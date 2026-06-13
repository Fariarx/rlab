import type { ChatMessage, ComposerDraft, ConversationSummary, Project } from "../domain/agent-types";
import type { AppSettings } from "./app-settings";
import type { WorkspaceState } from "./workspace-state";

export type WorkspaceProjectMutationMeta = Omit<Project, "conversations">;

export type WorkspaceMutation =
  | { readonly type: "setSelectedConversation"; readonly conversationId: string }
  | { readonly type: "setSettings"; readonly settings: AppSettings }
  | { readonly type: "upsertProject"; readonly project: WorkspaceProjectMutationMeta; readonly insertAtFront?: boolean }
  | { readonly type: "upsertConversation"; readonly conversation: ConversationSummary; readonly projectId: string | null; readonly insertAtFront?: boolean }
  | { readonly type: "updateConversation"; readonly conversation: ConversationSummary }
  | { readonly type: "deleteConversation"; readonly conversationId: string }
  | { readonly type: "setComposerDraft"; readonly conversationId: string; readonly draft: ComposerDraft }
  | { readonly type: "deleteComposerDraft"; readonly conversationId: string }
  | { readonly type: "upsertMessage"; readonly conversationId: string; readonly message: ChatMessage }
  | { readonly type: "upsertMessages"; readonly conversationId: string; readonly messages: readonly ChatMessage[] }
  | { readonly type: "replaceConversationThread"; readonly conversationId: string; readonly messages: readonly ChatMessage[] };

function removeConversationFromCollections(state: WorkspaceState, conversationId: string): WorkspaceState {
  return {
    ...state,
    chats: state.chats.filter((conversation) => conversation.id !== conversationId),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.filter((conversation) => conversation.id !== conversationId),
    })),
  };
}

function updateConversationInCollections(state: WorkspaceState, conversation: ConversationSummary): WorkspaceState {
  return {
    ...state,
    chats: state.chats.map((item) => (item.id === conversation.id ? conversation : item)),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.map((item) => (item.id === conversation.id ? conversation : item)),
    })),
  };
}

function findConversationProjectId(state: WorkspaceState, conversationId: string): string | null | undefined {
  if (state.chats.some((conversation) => conversation.id === conversationId)) {
    return null;
  }
  return state.projects.find((project) => project.conversations.some((conversation) => conversation.id === conversationId))?.id;
}

function upsertConversationInCollection(
  conversations: readonly ConversationSummary[],
  conversation: ConversationSummary,
  insertAtFront: boolean | undefined,
): ConversationSummary[] {
  const existingIndex = conversations.findIndex((item) => item.id === conversation.id);
  if (existingIndex >= 0) {
    return conversations.map((item, index) => (index === existingIndex ? conversation : item));
  }
  return insertAtFront ? [conversation, ...conversations] : [...conversations, conversation];
}

export function applyWorkspaceMutationToState(state: WorkspaceState, mutation: WorkspaceMutation): WorkspaceState {
  switch (mutation.type) {
    case "setSelectedConversation": {
      const selected =
        state.chats.find((conversation) => conversation.id === mutation.conversationId) ??
        state.projects.flatMap((project) => project.conversations).find((conversation) => conversation.id === mutation.conversationId);
      const selectedState = { ...state, selectedId: mutation.conversationId };
      return selected ? updateConversationInCollections(selectedState, { ...selected, unread: false }) : selectedState;
    }
    case "setSettings":
      return { ...state, settings: mutation.settings };
    case "upsertProject": {
      const existing = state.projects.find((project) => project.id === mutation.project.id);
      if (existing) {
        return {
          ...state,
          projects: state.projects.map((project) => (project.id === mutation.project.id ? { ...mutation.project, conversations: project.conversations } : project)),
        };
      }
      const nextProject: Project = { ...mutation.project, conversations: [] };
      return { ...state, projects: mutation.insertAtFront ? [nextProject, ...state.projects] : [...state.projects, nextProject] };
    }
    case "upsertConversation": {
      const currentProjectId = findConversationProjectId(state, mutation.conversation.id);
      if (currentProjectId === mutation.projectId) {
        if (mutation.projectId === null) {
          return { ...state, chats: upsertConversationInCollection(state.chats, mutation.conversation, mutation.insertAtFront) };
        }
        return {
          ...state,
          projects: state.projects.map((project) =>
            project.id === mutation.projectId ? { ...project, conversations: upsertConversationInCollection(project.conversations, mutation.conversation, mutation.insertAtFront) } : project,
          ),
        };
      }
      const withoutConversation = removeConversationFromCollections(state, mutation.conversation.id);
      if (mutation.projectId === null) {
        return {
          ...withoutConversation,
          chats: upsertConversationInCollection(withoutConversation.chats, mutation.conversation, mutation.insertAtFront),
        };
      }
      return {
        ...withoutConversation,
        projects: withoutConversation.projects.map((project) =>
          project.id === mutation.projectId
            ? { ...project, conversations: upsertConversationInCollection(project.conversations, mutation.conversation, mutation.insertAtFront) }
            : project,
        ),
      };
    }
    case "updateConversation":
      return updateConversationInCollections(state, mutation.conversation);
    case "deleteConversation": {
      const threads = { ...state.threads };
      const composerDrafts = { ...state.composerDrafts };
      delete threads[mutation.conversationId];
      delete composerDrafts[mutation.conversationId];
      return { ...removeConversationFromCollections(state, mutation.conversationId), threads, composerDrafts };
    }
    case "setComposerDraft":
      return { ...state, composerDrafts: { ...state.composerDrafts, [mutation.conversationId]: mutation.draft } };
    case "deleteComposerDraft": {
      const composerDrafts = { ...state.composerDrafts };
      delete composerDrafts[mutation.conversationId];
      return { ...state, composerDrafts };
    }
    case "upsertMessage": {
      const thread = state.threads[mutation.conversationId] ?? [];
      const existingIndex = thread.findIndex((message) => message.id === mutation.message.id);
      const nextThread = existingIndex >= 0 ? thread.map((message, index) => (index === existingIndex ? mutation.message : message)) : [...thread, mutation.message];
      return { ...state, threads: { ...state.threads, [mutation.conversationId]: nextThread } };
    }
    case "upsertMessages":
      return mutation.messages.reduce((current, message) => applyWorkspaceMutationToState(current, { type: "upsertMessage", conversationId: mutation.conversationId, message }), state);
    case "replaceConversationThread":
      return { ...state, threads: { ...state.threads, [mutation.conversationId]: [...mutation.messages] } };
  }
}

export function applyWorkspaceMutationsToState(state: WorkspaceState, mutations: readonly WorkspaceMutation[]): WorkspaceState {
  return mutations.reduce(applyWorkspaceMutationToState, state);
}
