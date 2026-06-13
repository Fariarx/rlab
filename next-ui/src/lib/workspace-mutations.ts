import type { ChatMessage, ComposerDraft, ConversationSummary, ConversationStatus, Project } from "../domain/agent-types";
import { isAgentId } from "./agent-catalog";
import { isAppSettings, type AppSettings } from "./app-settings";
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

export interface WorkspaceMutationRequest {
  readonly mutations: readonly WorkspaceMutation[];
  readonly baseRevision?: number;
}

export const workspaceMutationBadRequestMessages = new Set([
  "Invalid workspace mutation payload.",
  "Invalid workspace mutation.",
  "Invalid workspace base revision.",
  "Invalid workspace selected conversation mutation.",
  "Invalid workspace settings mutation.",
  "Invalid workspace project mutation.",
  "Invalid workspace conversation mutation.",
  "Invalid workspace draft mutation.",
  "Invalid workspace message mutation.",
  "Invalid workspace thread mutation.",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isConversationStatus(value: unknown): value is ConversationStatus {
  return value === "running" || value === "waiting" || value === "done" || value === "error" || value === "idle";
}

function isProjectMutationMeta(value: unknown): value is WorkspaceProjectMutationMeta {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string" && value.id.length > 0 && typeof value.name === "string" && (value.path === undefined || typeof value.path === "string");
}

function isConversationSummaryMutationValue(value: unknown): value is ConversationSummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string" &&
    typeof value.snippet === "string" &&
    typeof value.time === "string" &&
    isConversationStatus(value.status) &&
    isAgentId(value.agent)
  );
}

function isComposerDraftMutationValue(value: unknown): value is ComposerDraft {
  return isRecord(value) && typeof value.text === "string" && Array.isArray(value.attachments);
}

function isChatMessageMutationValue(value: unknown): value is ChatMessage {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return false;
  }
  if (value.role === "user") {
    return value.text === undefined || typeof value.text === "string";
  }
  if (value.role === "agent") {
    return value.blocks === undefined || Array.isArray(value.blocks);
  }
  return false;
}

export function parseWorkspaceMutation(mutation: unknown): WorkspaceMutation {
  if (!isRecord(mutation) || typeof mutation.type !== "string") {
    throw new Error("Invalid workspace mutation.");
  }
  switch (mutation.type) {
    case "setSelectedConversation":
      if (typeof mutation.conversationId !== "string") {
        throw new Error("Invalid workspace selected conversation mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId };
    case "setSettings":
      if (!isAppSettings(mutation.settings)) {
        throw new Error("Invalid workspace settings mutation.");
      }
      return { type: mutation.type, settings: mutation.settings };
    case "upsertProject":
      if (!isProjectMutationMeta(mutation.project) || !isOptionalBoolean(mutation.insertAtFront)) {
        throw new Error("Invalid workspace project mutation.");
      }
      return { type: mutation.type, project: mutation.project, insertAtFront: mutation.insertAtFront };
    case "upsertConversation":
      if (!isConversationSummaryMutationValue(mutation.conversation) || (mutation.projectId !== null && typeof mutation.projectId !== "string") || !isOptionalBoolean(mutation.insertAtFront)) {
        throw new Error("Invalid workspace conversation mutation.");
      }
      return { type: mutation.type, conversation: mutation.conversation, projectId: mutation.projectId, insertAtFront: mutation.insertAtFront };
    case "updateConversation":
      if (!isConversationSummaryMutationValue(mutation.conversation)) {
        throw new Error("Invalid workspace conversation mutation.");
      }
      return { type: mutation.type, conversation: mutation.conversation };
    case "deleteConversation":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0) {
        throw new Error("Invalid workspace conversation mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId };
    case "setComposerDraft":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0 || !isComposerDraftMutationValue(mutation.draft)) {
        throw new Error("Invalid workspace draft mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId, draft: mutation.draft };
    case "deleteComposerDraft":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0) {
        throw new Error("Invalid workspace draft mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId };
    case "upsertMessage":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0 || !isChatMessageMutationValue(mutation.message)) {
        throw new Error("Invalid workspace message mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId, message: mutation.message };
    case "upsertMessages":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0 || !Array.isArray(mutation.messages) || !mutation.messages.every(isChatMessageMutationValue)) {
        throw new Error("Invalid workspace message mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId, messages: mutation.messages };
    case "replaceConversationThread":
      if (typeof mutation.conversationId !== "string" || mutation.conversationId.length === 0 || !Array.isArray(mutation.messages) || !mutation.messages.every(isChatMessageMutationValue)) {
        throw new Error("Invalid workspace thread mutation.");
      }
      return { type: mutation.type, conversationId: mutation.conversationId, messages: mutation.messages };
    default:
      throw new Error("Invalid workspace mutation.");
  }
}

export function parseWorkspaceMutationRequestBody(body: string): WorkspaceMutationRequest {
  const parsed = JSON.parse(body) as unknown;
  const mutations = isRecord(parsed) ? parsed.mutations : parsed;
  if (!Array.isArray(mutations)) {
    throw new Error("Invalid workspace mutation payload.");
  }
  const rawBaseRevision = isRecord(parsed) ? parsed.baseRevision : undefined;
  if (rawBaseRevision !== undefined && (typeof rawBaseRevision !== "number" || !Number.isInteger(rawBaseRevision) || rawBaseRevision < 0)) {
    throw new Error("Invalid workspace base revision.");
  }
  return {
    mutations: mutations.map(parseWorkspaceMutation),
    ...(typeof rawBaseRevision === "number" ? { baseRevision: rawBaseRevision } : {}),
  };
}

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
