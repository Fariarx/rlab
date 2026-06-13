import { rlabCommands, type RlabSseEvent, type RlabTypedCommandEnvelope, type ThreadMessageView as RlabThreadMessageView, type WorkspaceView as RlabWorkspaceView } from "../generated/rlab-api";
import { isAgentId, normalizeAgentProfile } from "./agent-catalog";
import { defaultAppSettings, mergeAppSettings, type Locale } from "./app-settings";
import type { RlabEvent, RlabEventMetadata } from "./rlab-events";
import type { WorkspaceMutation } from "./workspace-mutations";
import type { WorkspaceState } from "./workspace-state";
import type { AgentBlock, ChatMessage, ConversationStatus, ConversationSummary, Project, RunUsage } from "../domain/agent-types";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Generated RLab payload is missing required string '${field}'.`);
  }
  return value;
}

function optionalString(value: string | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value;
}

function normalizeLocale(value: string): Locale {
  if (value !== "en" && value !== "ru") {
    throw new Error(`Unsupported workspace locale from backend: ${value}.`);
  }
  return value;
}

function normalizeStatus(value: string): ConversationStatus {
  if (value !== "running" && value !== "waiting" && value !== "done" && value !== "error" && value !== "idle") {
    throw new Error(`Unsupported conversation status from backend: ${value}.`);
  }
  return value;
}

function normalizeAgent(value: string) {
  if (!isAgentId(value)) {
    throw new Error(`Unsupported conversation agent from backend: ${value}.`);
  }
  return value;
}

function jsonClone<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBlocks(value: ReadonlyArray<unknown> | null | undefined): readonly AgentBlock[] | undefined {
  return value === null || value === undefined ? undefined : jsonClone<AgentBlock[]>(value);
}

function normalizeUsage(value: unknown): RunUsage | undefined {
  return value === null || value === undefined ? undefined : jsonClone<RunUsage>(value);
}

function normalizeChatMessage(message: RlabThreadMessageView["message"]): ChatMessage {
  const role = message.role;
  if (role !== "user" && role !== "agent") {
    throw new Error(`Unsupported chat message role from backend: ${role}.`);
  }
  const agent = role === "agent" && message.profile !== null && message.profile !== undefined ? normalizeAgentProfile(message.profile, "claude-code") : undefined;
  return {
    id: requiredString(message.id, "message.id"),
    role,
    ...(message.time ? { time: message.time } : {}),
    ...(message.startedAtMs !== null && message.startedAtMs !== undefined ? { startedAtMs: message.startedAtMs } : {}),
    ...(agent ? { profile: agent } : {}),
    ...(message.text !== null && message.text !== undefined ? { text: message.text } : {}),
    ...(message.blocks !== null && message.blocks !== undefined ? { blocks: normalizeBlocks(message.blocks) } : {}),
    ...(message.costUsd !== null && message.costUsd !== undefined ? { costUsd: message.costUsd } : {}),
    ...(message.usage !== null && message.usage !== undefined ? { usage: normalizeUsage(message.usage) } : {}),
  };
}

function normalizeConversation(summary: RlabWorkspaceView["chats"][number]): ConversationSummary {
  const agent = normalizeAgent(summary.agent);
  return {
    id: requiredString(summary.id, "conversation.id"),
    title: summary.title,
    snippet: summary.snippet,
    time: summary.time,
    status: normalizeStatus(summary.status),
    agent,
    profile: normalizeAgentProfile(undefined, agent),
    ...(summary.activeRunId ? { activeRunId: summary.activeRunId } : {}),
    archived: summary.archived,
    pinned: summary.pinned,
  };
}

function normalizeProject(project: RlabWorkspaceView["projects"][number]): Project {
  return {
    id: requiredString(project.id, "project.id"),
    name: project.name,
    ...(project.path ? { path: project.path } : {}),
    conversations: project.conversations.map(normalizeConversation),
  };
}

export function workspaceViewToState(view: RlabWorkspaceView): WorkspaceState {
  return {
    chats: view.chats.map(normalizeConversation),
    projects: view.projects.map(normalizeProject),
    threads: {},
    composerDrafts: {},
    selectedId: view.selectedId,
    settings: mergeAppSettings(defaultAppSettings, { general: { locale: normalizeLocale(view.settings.locale) } }),
  };
}

export function threadMessageViewsToMessages(messages: readonly RlabThreadMessageView[]): ChatMessage[] {
  return [...messages].sort((left, right) => left.position - right.position).map((item) => normalizeChatMessage(item.message));
}

function appendUserMessageCommand(
  commandId: string,
  clientId: string,
  conversationId: string,
  message: ChatMessage,
): Extract<RlabTypedCommandEnvelope, { readonly type: "workspace.appendUserMessage" }> {
  if (message.role !== "user") {
    throw new Error(`Message '${message.id}' is '${message.role}', but workspace.appendUserMessage only accepts user messages.`);
  }
  if (typeof message.text !== "string") {
    throw new Error(`User message '${message.id}' has no text and cannot be persisted as workspace.appendUserMessage.`);
  }
  if (typeof message.time !== "string") {
    throw new Error(`User message '${message.id}' has no time and cannot be persisted as workspace.appendUserMessage.`);
  }
  return {
    commandId,
    clientId,
    type: "workspace.appendUserMessage",
    version: rlabCommands["workspace.appendUserMessage"],
    data: {
      conversationId,
      messageId: message.id,
      text: message.text,
      time: message.time,
    },
    correlationId: commandId,
  };
}

export function workspaceMutationToGeneratedCommandEnvelopes(
  mutation: WorkspaceMutation,
  clientId: string,
  nextCommandId: () => string,
): RlabTypedCommandEnvelope[] {
  switch (mutation.type) {
    case "setSelectedConversation": {
      const commandId = nextCommandId();
      return [
        {
          commandId,
          clientId,
          type: "workspace.selectConversation",
          version: rlabCommands["workspace.selectConversation"],
          data: { conversationId: mutation.conversationId },
          correlationId: commandId,
        },
      ];
    }
    case "upsertConversation": {
      const commandId = nextCommandId();
      return [
        {
          commandId,
          clientId,
          type: "workspace.createConversation",
          version: rlabCommands["workspace.createConversation"],
          data: {
            conversationId: mutation.conversation.id,
            title: mutation.conversation.title,
            agent: mutation.conversation.agent,
            projectId: mutation.projectId,
          },
          correlationId: commandId,
        },
      ];
    }
    case "upsertMessage":
      return [appendUserMessageCommand(nextCommandId(), clientId, mutation.conversationId, mutation.message)];
    case "upsertMessages":
      return mutation.messages.map((message) => appendUserMessageCommand(nextCommandId(), clientId, mutation.conversationId, message));
    case "setSettings":
    case "upsertProject":
    case "updateConversation":
    case "deleteConversation":
    case "setComposerDraft":
    case "deleteComposerDraft":
    case "replaceConversationThread":
      throw new Error(`Workspace mutation '${mutation.type}' has no C# event-sourced command yet.`);
  }
}

function sseMetadata(event: RlabSseEvent): RlabEventMetadata {
  const commandId = requiredString(event.commandId, "event.commandId");
  return {
    schemaVersion: 1,
    commandId,
    clientId: requiredString(event.clientId, "event.clientId"),
    correlationId: event.correlationId ?? commandId,
    ...(event.causationId ? { causationId: event.causationId } : {}),
    createdAt: event.createdAt,
  };
}

export function sseEventToWorkspaceEvent(event: RlabSseEvent): RlabEvent {
  const metadata = sseMetadata(event);
  switch (event.type) {
    case "conversation.created":
    case "conversation.messageAppended":
    case "conversation.runFinished":
    case "conversation.runStarted":
    case "workspace.selectedConversationSet":
    case "run.cancelled":
    case "run.completed":
    case "run.failed":
    case "run.inputProvided":
    case "run.outputRecorded":
    case "run.requested":
    case "run.started":
    case "run.waitingForInput":
      return { type: event.type, data: event.data, metadata } as RlabEvent;
  }
}
