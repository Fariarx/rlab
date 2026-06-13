import type { AgentId } from "./agent-catalog";
import type { RunEvent } from "./run-event-accumulator";
import { z } from "zod";
import { applyWorkspaceMutationToState, type WorkspaceMutation } from "./workspace-mutations";
import { buildEmptyWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./workspace-state";
import type { ChatMessage, ConversationSummary, Project } from "../domain/agent-types";

export const RLAB_EVENT_SCHEMA_VERSION = 1;

export interface RlabEventMetadata {
  readonly schemaVersion: number;
  readonly commandId: string;
  readonly clientId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly createdAt: string;
}

export type RlabCommand =
  | { readonly type: "workspace.setSelectedConversation"; readonly conversationId: string }
  | { readonly type: "workspace.setSettings"; readonly settings: WorkspaceState["settings"] }
  | { readonly type: "workspace.upsertProject"; readonly project: Extract<WorkspaceMutation, { readonly type: "upsertProject" }>["project"]; readonly insertAtFront?: boolean }
  | {
      readonly type: "workspace.upsertConversation";
      readonly conversation: ConversationSummary;
      readonly projectId: string | null;
      readonly insertAtFront?: boolean;
    }
  | { readonly type: "workspace.updateConversation"; readonly conversation: ConversationSummary }
  | { readonly type: "workspace.deleteConversation"; readonly conversationId: string }
  | { readonly type: "workspace.setComposerDraft"; readonly conversationId: string; readonly draft: Extract<WorkspaceMutation, { readonly type: "setComposerDraft" }>["draft"] }
  | { readonly type: "workspace.deleteComposerDraft"; readonly conversationId: string }
  | { readonly type: "workspace.upsertMessage"; readonly conversationId: string; readonly message: ChatMessage }
  | { readonly type: "workspace.upsertMessages"; readonly conversationId: string; readonly messages: readonly ChatMessage[] }
  | { readonly type: "workspace.replaceConversationThread"; readonly conversationId: string; readonly messages: readonly ChatMessage[] }
  | {
      readonly type: "run.request";
      readonly runId: string;
      readonly conversationId: string;
      readonly userMessageId: string;
      readonly agentMessageId: string;
      readonly prompt: string;
      readonly agent: AgentId;
      readonly model: string;
      readonly reasoning: string;
      readonly mode: string;
    }
  | { readonly type: "run.cancel"; readonly runId: string; readonly conversationId: string; readonly reason?: string };

export interface RlabCommandEnvelope {
  readonly commandId: string;
  readonly clientId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly command: RlabCommand;
}

export interface RlabCommandRequest {
  readonly commands: readonly RlabCommandEnvelope[];
}

export interface RlabRunRequestedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly prompt: string;
  readonly agent: AgentId;
  readonly model: string;
  readonly reasoning: string;
  readonly mode: string;
}

export interface RlabRunStartedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly startedAt: string;
}

export interface RlabRunOutputRecordedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly event: RunEvent;
}

export interface RlabRunWaitingForInputData {
  readonly runId: string;
  readonly conversationId: string;
  readonly inputId: string;
  readonly inputType: "approval" | "options";
}

export interface RlabRunInputProvidedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly inputId: string;
  readonly value: unknown;
}

export interface RlabRunCompletedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly event?: Extract<RunEvent, { readonly type: "done" }>;
}

export interface RlabRunFailedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly error: string;
}

export interface RlabRunCancelledData {
  readonly runId: string;
  readonly conversationId: string;
  readonly reason?: string;
}

export interface RlabRunInterruptedData {
  readonly runId: string;
  readonly conversationId: string;
  readonly reason: string;
}

export type RlabEvent =
  | { readonly type: "workspace.initialized"; readonly data: { readonly state: WorkspaceState }; readonly metadata: RlabEventMetadata }
  | { readonly type: "workspace.selectedConversationSet"; readonly data: { readonly conversationId: string }; readonly metadata: RlabEventMetadata }
  | {
      readonly type: "workspace.settingsSet";
      readonly data: { readonly settings: WorkspaceState["settings"] };
      readonly metadata: RlabEventMetadata;
    }
  | {
      readonly type: "workspace.projectUpserted";
      readonly data: { readonly project: Extract<WorkspaceMutation, { readonly type: "upsertProject" }>["project"]; readonly insertAtFront?: boolean };
      readonly metadata: RlabEventMetadata;
    }
  | {
      readonly type: "workspace.conversationUpserted";
      readonly data: { readonly conversation: ConversationSummary; readonly projectId: string | null; readonly insertAtFront?: boolean };
      readonly metadata: RlabEventMetadata;
    }
  | { readonly type: "workspace.conversationUpdated"; readonly data: { readonly conversation: ConversationSummary }; readonly metadata: RlabEventMetadata }
  | { readonly type: "workspace.conversationDeleted"; readonly data: { readonly conversationId: string }; readonly metadata: RlabEventMetadata }
  | {
      readonly type: "workspace.composerDraftSet";
      readonly data: { readonly conversationId: string; readonly draft: Extract<WorkspaceMutation, { readonly type: "setComposerDraft" }>["draft"] };
      readonly metadata: RlabEventMetadata;
    }
  | { readonly type: "workspace.composerDraftDeleted"; readonly data: { readonly conversationId: string }; readonly metadata: RlabEventMetadata }
  | { readonly type: "workspace.messageUpserted"; readonly data: { readonly conversationId: string; readonly message: ChatMessage }; readonly metadata: RlabEventMetadata }
  | {
      readonly type: "workspace.messagesUpserted";
      readonly data: { readonly conversationId: string; readonly messages: readonly ChatMessage[] };
      readonly metadata: RlabEventMetadata;
    }
  | {
      readonly type: "workspace.conversationThreadReplaced";
      readonly data: { readonly conversationId: string; readonly messages: readonly ChatMessage[] };
      readonly metadata: RlabEventMetadata;
    }
  | {
      readonly type: "workspace.agentMessageUpsertedForUserTurn";
      readonly data: { readonly conversationId: string; readonly userMessageId: string; readonly message: ChatMessage };
      readonly metadata: RlabEventMetadata;
    }
  | {
      readonly type: "run.rawBatchRecorded";
      readonly data: { readonly runId: string; readonly conversationId: string; readonly events: readonly RunEvent[] };
      readonly metadata: RlabEventMetadata;
    }
  | { readonly type: "run.requested"; readonly data: RlabRunRequestedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.started"; readonly data: RlabRunStartedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.outputRecorded"; readonly data: RlabRunOutputRecordedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.waitingForInput"; readonly data: RlabRunWaitingForInputData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.inputProvided"; readonly data: RlabRunInputProvidedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.completed"; readonly data: RlabRunCompletedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.failed"; readonly data: RlabRunFailedData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.cancelled"; readonly data: RlabRunCancelledData; readonly metadata: RlabEventMetadata }
  | { readonly type: "run.interrupted"; readonly data: RlabRunInterruptedData; readonly metadata: RlabEventMetadata };

export type RlabEventType = RlabEvent["type"];

export interface RecordedRlabEvent {
  readonly type: RlabEventType;
  readonly data: RlabEvent["data"];
  readonly metadata: RlabEventMetadata;
  readonly streamName: string;
  readonly streamPosition: string;
  readonly globalPosition: string;
}

export interface RlabSnapshot {
  readonly state: WorkspaceState;
  readonly checkpoint: string;
}

const nonEmptyStringSchema = z.string().min(1);
const chatMessageSchema = z.object({ id: nonEmptyStringSchema, role: z.union([z.literal("user"), z.literal("agent")]) }).passthrough() as z.ZodType<ChatMessage>;
const conversationSchema = z
  .object({
    id: nonEmptyStringSchema,
    title: z.string(),
    snippet: z.string(),
    time: z.string(),
    status: z.union([z.literal("running"), z.literal("waiting"), z.literal("done"), z.literal("error"), z.literal("idle")]),
    agent: z.union([z.literal("claude-code"), z.literal("codex"), z.literal("gemini"), z.literal("opencode")]),
  })
  .passthrough() as z.ZodType<ConversationSummary>;
const projectSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: z.string(),
    path: z.string().optional(),
    conversations: z.array(conversationSchema),
  })
  .passthrough() as z.ZodType<Project>;
const projectMetaSchema = z.object({ id: nonEmptyStringSchema, name: z.string(), path: z.string().optional() }).passthrough() as z.ZodType<
  Extract<WorkspaceMutation, { readonly type: "upsertProject" }>["project"]
>;
const settingsSchema = z.record(z.string(), z.unknown()) as unknown as z.ZodType<WorkspaceState["settings"]>;
const composerDraftSchema = z.object({ text: z.string(), attachments: z.array(z.unknown()) }).passthrough() as z.ZodType<
  Extract<WorkspaceMutation, { readonly type: "setComposerDraft" }>["draft"]
>;
const agentIdSchema = z.union([z.literal("claude-code"), z.literal("codex"), z.literal("gemini"), z.literal("opencode")]) satisfies z.ZodType<AgentId>;
const runStateSchema = z.union([z.literal("pending"), z.literal("running"), z.literal("ok"), z.literal("error")]);
const runEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool"), id: nonEmptyStringSchema, name: z.string(), summary: z.string().optional(), args: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal("tool_result"), id: nonEmptyStringSchema, ok: z.boolean(), output: z.string() }),
  z.object({ type: z.literal("diff"), id: z.string().optional(), file: z.string(), additions: z.number(), deletions: z.number(), lines: z.array(z.unknown()) }),
  z.object({ type: z.literal("plan"), id: z.string().optional(), steps: z.array(z.unknown()) }),
  z.object({ type: z.literal("code"), language: z.string(), code: z.string() }),
  z.object({ type: z.literal("search"), id: z.string().optional(), query: z.string(), state: runStateSchema, results: z.array(z.unknown()).optional() }),
  z.object({ type: z.literal("suggested"), actions: z.array(z.unknown()) }),
  z.object({ type: z.literal("approval"), id: nonEmptyStringSchema, title: z.string(), detail: z.string().optional() }),
  z.object({
    type: z.literal("options"),
    id: nonEmptyStringSchema,
    prompt: z.string(),
    multi: z.boolean().optional(),
    options: z.array(z.object({ id: nonEmptyStringSchema, label: z.string(), description: z.string().optional() })),
  }),
  z.object({ type: z.literal("status"), level: z.union([z.literal("info"), z.literal("ok"), z.literal("warn"), z.literal("error")]), text: z.string() }),
  z.object({ type: z.literal("error"), text: z.string() }),
  z.object({ type: z.literal("session"), id: nonEmptyStringSchema }),
  z.object({
    type: z.literal("wakeup"),
    prompt: z.string(),
    reason: z.string().optional(),
    toolId: z.string().optional(),
    delaySeconds: z.number().optional(),
    fireAt: z.string().optional(),
    cron: z.string().optional(),
    script: z.string().optional(),
    intervalSeconds: z.number().optional(),
  }),
  z.object({ type: z.literal("cancel_wakeup"), wakeupId: z.string().optional(), all: z.boolean().optional(), reason: z.string().optional(), toolId: z.string().optional() }),
  z.object({ type: z.literal("done"), costUsd: z.number().optional(), usage: z.unknown().optional(), usageDebug: z.unknown().optional() }),
]) as z.ZodType<RunEvent>;
const workspaceStateSchema = z
  .object({
    chats: z.array(conversationSchema),
    projects: z.array(projectSchema),
    threads: z.record(z.string(), z.array(chatMessageSchema)),
    composerDrafts: z.record(z.string(), composerDraftSchema),
    selectedId: z.string(),
    settings: settingsSchema,
  })
  .passthrough() as z.ZodType<WorkspaceState>;
const eventMetadataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  commandId: z.string(),
  clientId: z.string(),
  correlationId: z.string(),
  causationId: z.string().optional(),
  createdAt: z.string(),
}) satisfies z.ZodType<RlabEventMetadata>;

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace.setSelectedConversation"), conversationId: z.string() }),
  z.object({ type: z.literal("workspace.setSettings"), settings: settingsSchema }),
  z.object({ type: z.literal("workspace.upsertProject"), project: projectMetaSchema, insertAtFront: z.boolean().optional() }),
  z.object({ type: z.literal("workspace.upsertConversation"), conversation: conversationSchema, projectId: z.string().nullable(), insertAtFront: z.boolean().optional() }),
  z.object({ type: z.literal("workspace.updateConversation"), conversation: conversationSchema }),
  z.object({ type: z.literal("workspace.deleteConversation"), conversationId: nonEmptyStringSchema }),
  z.object({ type: z.literal("workspace.setComposerDraft"), conversationId: nonEmptyStringSchema, draft: composerDraftSchema }),
  z.object({ type: z.literal("workspace.deleteComposerDraft"), conversationId: nonEmptyStringSchema }),
  z.object({ type: z.literal("workspace.upsertMessage"), conversationId: nonEmptyStringSchema, message: chatMessageSchema }),
  z.object({ type: z.literal("workspace.upsertMessages"), conversationId: nonEmptyStringSchema, messages: z.array(chatMessageSchema) }),
  z.object({ type: z.literal("workspace.replaceConversationThread"), conversationId: nonEmptyStringSchema, messages: z.array(chatMessageSchema) }),
  z.object({
    type: z.literal("run.request"),
    runId: nonEmptyStringSchema,
    conversationId: nonEmptyStringSchema,
    userMessageId: nonEmptyStringSchema,
    agentMessageId: nonEmptyStringSchema,
    prompt: z.string(),
    agent: agentIdSchema,
    model: z.string(),
    reasoning: z.string(),
    mode: z.string(),
  }),
  z.object({ type: z.literal("run.cancel"), runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, reason: z.string().optional() }),
]) satisfies z.ZodType<RlabCommand>;

const commandEnvelopeSchema = z.object({
  commandId: nonEmptyStringSchema,
  clientId: nonEmptyStringSchema,
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  command: commandSchema,
}) satisfies z.ZodType<RlabCommandEnvelope>;

export const rlabCommandRequestSchema = z.object({ commands: z.array(commandEnvelopeSchema) }) satisfies z.ZodType<RlabCommandRequest>;
export const rlabEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace.initialized"), data: z.object({ state: workspaceStateSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.selectedConversationSet"), data: z.object({ conversationId: z.string() }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.settingsSet"), data: z.object({ settings: settingsSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.projectUpserted"), data: z.object({ project: projectMetaSchema, insertAtFront: z.boolean().optional() }), metadata: eventMetadataSchema }),
  z.object({
    type: z.literal("workspace.conversationUpserted"),
    data: z.object({ conversation: conversationSchema, projectId: z.string().nullable(), insertAtFront: z.boolean().optional() }),
    metadata: eventMetadataSchema,
  }),
  z.object({ type: z.literal("workspace.conversationUpdated"), data: z.object({ conversation: conversationSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.conversationDeleted"), data: z.object({ conversationId: nonEmptyStringSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.composerDraftSet"), data: z.object({ conversationId: nonEmptyStringSchema, draft: composerDraftSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.composerDraftDeleted"), data: z.object({ conversationId: nonEmptyStringSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.messageUpserted"), data: z.object({ conversationId: nonEmptyStringSchema, message: chatMessageSchema }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("workspace.messagesUpserted"), data: z.object({ conversationId: nonEmptyStringSchema, messages: z.array(chatMessageSchema) }), metadata: eventMetadataSchema }),
  z.object({
    type: z.literal("workspace.conversationThreadReplaced"),
    data: z.object({ conversationId: nonEmptyStringSchema, messages: z.array(chatMessageSchema) }),
    metadata: eventMetadataSchema,
  }),
  z.object({
    type: z.literal("workspace.agentMessageUpsertedForUserTurn"),
    data: z.object({ conversationId: nonEmptyStringSchema, userMessageId: nonEmptyStringSchema, message: chatMessageSchema }),
    metadata: eventMetadataSchema,
  }),
  z.object({ type: z.literal("run.rawBatchRecorded"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, events: z.array(runEventSchema) }), metadata: eventMetadataSchema }),
  z.object({
    type: z.literal("run.requested"),
    data: z.object({
      runId: nonEmptyStringSchema,
      conversationId: nonEmptyStringSchema,
      userMessageId: nonEmptyStringSchema,
      agentMessageId: nonEmptyStringSchema,
      prompt: z.string(),
      agent: agentIdSchema,
      model: z.string(),
      reasoning: z.string(),
      mode: z.string(),
    }),
    metadata: eventMetadataSchema,
  }),
  z.object({
    type: z.literal("run.started"),
    data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, userMessageId: nonEmptyStringSchema, agentMessageId: nonEmptyStringSchema, startedAt: z.string() }),
    metadata: eventMetadataSchema,
  }),
  z.object({ type: z.literal("run.outputRecorded"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, event: runEventSchema }), metadata: eventMetadataSchema }),
  z.object({
    type: z.literal("run.waitingForInput"),
    data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, inputId: nonEmptyStringSchema, inputType: z.union([z.literal("approval"), z.literal("options")]) }),
    metadata: eventMetadataSchema,
  }),
  z.object({ type: z.literal("run.inputProvided"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, inputId: nonEmptyStringSchema, value: z.unknown() }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("run.completed"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, event: runEventSchema.optional() }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("run.failed"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, error: z.string() }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("run.cancelled"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, reason: z.string().optional() }), metadata: eventMetadataSchema }),
  z.object({ type: z.literal("run.interrupted"), data: z.object({ runId: nonEmptyStringSchema, conversationId: nonEmptyStringSchema, reason: z.string() }), metadata: eventMetadataSchema }),
]) as z.ZodType<RlabEvent>;

export function parseRlabCommandRequestBody(body: string): RlabCommandRequest {
  return rlabCommandRequestSchema.parse(JSON.parse(body) as unknown);
}

export function parseRlabEvent(value: unknown): RlabEvent {
  return rlabEventSchema.parse(value);
}

export function workspaceMutationToCommand(mutation: WorkspaceMutation): RlabCommand {
  switch (mutation.type) {
    case "setSelectedConversation":
      return { type: "workspace.setSelectedConversation", conversationId: mutation.conversationId };
    case "setSettings":
      return { type: "workspace.setSettings", settings: mutation.settings };
    case "upsertProject":
      return { type: "workspace.upsertProject", project: mutation.project, insertAtFront: mutation.insertAtFront };
    case "upsertConversation":
      return { type: "workspace.upsertConversation", conversation: mutation.conversation, projectId: mutation.projectId, insertAtFront: mutation.insertAtFront };
    case "updateConversation":
      return { type: "workspace.updateConversation", conversation: mutation.conversation };
    case "deleteConversation":
      return { type: "workspace.deleteConversation", conversationId: mutation.conversationId };
    case "setComposerDraft":
      return { type: "workspace.setComposerDraft", conversationId: mutation.conversationId, draft: mutation.draft };
    case "deleteComposerDraft":
      return { type: "workspace.deleteComposerDraft", conversationId: mutation.conversationId };
    case "upsertMessage":
      return { type: "workspace.upsertMessage", conversationId: mutation.conversationId, message: mutation.message };
    case "upsertMessages":
      return { type: "workspace.upsertMessages", conversationId: mutation.conversationId, messages: mutation.messages };
    case "replaceConversationThread":
      return { type: "workspace.replaceConversationThread", conversationId: mutation.conversationId, messages: mutation.messages };
  }
}

export function commandToEvent(envelope: RlabCommandEnvelope, createdAt = new Date().toISOString()): RlabEvent {
  const metadata: RlabEventMetadata = {
    schemaVersion: RLAB_EVENT_SCHEMA_VERSION,
    commandId: envelope.commandId,
    clientId: envelope.clientId,
    correlationId: envelope.correlationId ?? envelope.commandId,
    ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
    createdAt,
  };
  const { command } = envelope;
  switch (command.type) {
    case "workspace.setSelectedConversation":
      return { type: "workspace.selectedConversationSet", data: { conversationId: command.conversationId }, metadata };
    case "workspace.setSettings":
      return { type: "workspace.settingsSet", data: { settings: command.settings }, metadata };
    case "workspace.upsertProject":
      return { type: "workspace.projectUpserted", data: { project: command.project, insertAtFront: command.insertAtFront }, metadata };
    case "workspace.upsertConversation":
      return { type: "workspace.conversationUpserted", data: { conversation: command.conversation, projectId: command.projectId, insertAtFront: command.insertAtFront }, metadata };
    case "workspace.updateConversation":
      return { type: "workspace.conversationUpdated", data: { conversation: command.conversation }, metadata };
    case "workspace.deleteConversation":
      return { type: "workspace.conversationDeleted", data: { conversationId: command.conversationId }, metadata };
    case "workspace.setComposerDraft":
      return { type: "workspace.composerDraftSet", data: { conversationId: command.conversationId, draft: command.draft }, metadata };
    case "workspace.deleteComposerDraft":
      return { type: "workspace.composerDraftDeleted", data: { conversationId: command.conversationId }, metadata };
    case "workspace.upsertMessage":
      return { type: "workspace.messageUpserted", data: { conversationId: command.conversationId, message: command.message }, metadata };
    case "workspace.upsertMessages":
      return { type: "workspace.messagesUpserted", data: { conversationId: command.conversationId, messages: command.messages }, metadata };
    case "workspace.replaceConversationThread":
      return { type: "workspace.conversationThreadReplaced", data: { conversationId: command.conversationId, messages: command.messages }, metadata };
    case "run.request":
      return {
        type: "run.requested",
        data: {
          runId: command.runId,
          conversationId: command.conversationId,
          userMessageId: command.userMessageId,
          agentMessageId: command.agentMessageId,
          prompt: command.prompt,
          agent: command.agent,
          model: command.model,
          reasoning: command.reasoning,
          mode: command.mode,
        },
        metadata,
      };
    case "run.cancel":
      return { type: "run.cancelled", data: { runId: command.runId, conversationId: command.conversationId, reason: command.reason }, metadata };
  }
}

export function commandStreamName(command: RlabCommand): string {
  switch (command.type) {
    case "workspace.upsertConversation":
    case "workspace.updateConversation":
    case "workspace.deleteConversation":
    case "workspace.setComposerDraft":
    case "workspace.deleteComposerDraft":
    case "workspace.upsertMessage":
    case "workspace.upsertMessages":
    case "workspace.replaceConversationThread":
      return `conversation:${"conversationId" in command ? command.conversationId : command.conversation.id}`;
    case "workspace.upsertProject":
      return `project:${command.project.id}`;
    case "workspace.setSelectedConversation":
    case "workspace.setSettings":
      return "workspace";
    case "run.request":
    case "run.cancel":
      return `run:${command.runId}`;
  }
}

function eventToWorkspaceMutation(event: RlabEvent): WorkspaceMutation | null {
  switch (event.type) {
    case "workspace.selectedConversationSet":
      return { type: "setSelectedConversation", conversationId: event.data.conversationId };
    case "workspace.settingsSet":
      return { type: "setSettings", settings: event.data.settings };
    case "workspace.projectUpserted":
      return { type: "upsertProject", project: event.data.project, insertAtFront: event.data.insertAtFront };
    case "workspace.conversationUpserted":
      return { type: "upsertConversation", conversation: event.data.conversation, projectId: event.data.projectId, insertAtFront: event.data.insertAtFront };
    case "workspace.conversationUpdated":
      return { type: "updateConversation", conversation: event.data.conversation };
    case "workspace.conversationDeleted":
      return { type: "deleteConversation", conversationId: event.data.conversationId };
    case "workspace.composerDraftSet":
      return { type: "setComposerDraft", conversationId: event.data.conversationId, draft: event.data.draft };
    case "workspace.composerDraftDeleted":
      return { type: "deleteComposerDraft", conversationId: event.data.conversationId };
    case "workspace.messageUpserted":
      return { type: "upsertMessage", conversationId: event.data.conversationId, message: event.data.message };
    case "workspace.messagesUpserted":
      return { type: "upsertMessages", conversationId: event.data.conversationId, messages: event.data.messages };
    case "workspace.conversationThreadReplaced":
      return { type: "replaceConversationThread", conversationId: event.data.conversationId, messages: event.data.messages };
    case "workspace.initialized":
    case "workspace.agentMessageUpsertedForUserTurn":
    case "run.rawBatchRecorded":
    case "run.requested":
    case "run.started":
    case "run.outputRecorded":
    case "run.waitingForInput":
    case "run.inputProvided":
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
    case "run.interrupted":
      return null;
  }
}

export function upsertAgentMessageForUserTurnInThread(messages: readonly ChatMessage[], userMessageId: string, message: ChatMessage): ChatMessage[] {
  const userIndex = messages.findIndex((item) => item.id === userMessageId && item.role === "user");
  if (userIndex < 0) {
    return [...messages, message];
  }
  const nextUserIndex = messages.findIndex((item, index) => index > userIndex && item.role === "user");
  const before = messages.slice(0, userIndex + 1);
  const after = nextUserIndex >= 0 ? messages.slice(nextUserIndex) : [];
  return [...before, message, ...after];
}

export function applyRlabEventToState(state: WorkspaceState, event: RlabEvent): WorkspaceState {
  if (event.type === "workspace.initialized") {
    return cloneWorkspaceState(event.data.state);
  }
  if (event.type === "workspace.agentMessageUpsertedForUserTurn") {
    const thread = state.threads[event.data.conversationId] ?? [];
    return {
      ...state,
      threads: {
        ...state.threads,
        [event.data.conversationId]: upsertAgentMessageForUserTurnInThread(thread, event.data.userMessageId, event.data.message),
      },
    };
  }
  const mutation = eventToWorkspaceMutation(event);
  return mutation ? applyWorkspaceMutationToState(state, mutation) : state;
}

export function projectRlabEvents(events: readonly RlabEvent[], initialState: WorkspaceState = buildEmptyWorkspaceState()): WorkspaceState {
  return events.reduce(applyRlabEventToState, cloneWorkspaceState(initialState));
}

export function normalizeAgentSessions(conversation: ConversationSummary): ConversationSummary {
  const agentSessions: Partial<Record<AgentId, string>> = {};
  for (const [agent, sessionId] of Object.entries(conversation.agentSessions ?? {})) {
    if (typeof sessionId === "string" && sessionId.trim().length > 0) {
      agentSessions[agent as AgentId] = sessionId;
    }
  }
  return Object.keys(agentSessions).length > 0 ? { ...conversation, agentSessions } : { ...conversation, agentSessions: undefined };
}
