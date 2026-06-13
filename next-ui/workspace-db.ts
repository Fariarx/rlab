import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { defaultTag, schemaSQL } from "@event-driven-io/emmett-sqlite";
import type { AgentBlock, ChatMessage, ConversationSummary } from "./src/domain/agent-types";
import { conversationPreviewSnippet, messagePreviewText, previewSnippet } from "./src/lib/conversation-preview";
import type { RunEvent } from "./src/lib/run-event-accumulator";
import {
  applyRlabEventToState,
  commandStreamName,
  commandToEvent,
  parseRlabEvent,
  type RecordedRlabEvent,
  type RlabCommandEnvelope,
  type RlabEvent,
  type RlabEventMetadata,
  type RlabEventType,
  type RlabRunCancelledData,
  type RlabRunCompletedData,
  type RlabRunFailedData,
  type RlabRunInputProvidedData,
  type RlabRunInterruptedData,
  type RlabRunOutputRecordedData,
  type RlabRunRequestedData,
  type RlabRunStartedData,
  type RlabRunWaitingForInputData,
  upsertAgentMessageForUserTurnInThread,
  workspaceMutationToCommand,
} from "./src/lib/rlab-events";
import type { WorkspaceMutation } from "./src/lib/workspace-mutations";
import { buildEmptyWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./src/lib/workspace-state";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
type DatabaseHandle = InstanceType<typeof DatabaseSync>;

let db: DatabaseHandle | null = null;
const PREVIEW_SNIPPET_LOOKBACK_MESSAGES = 20;
const RLAB_COMMAND_RESULTS_SQL = `
CREATE TABLE IF NOT EXISTS rlab_command_results (
  command_id TEXT PRIMARY KEY,
  global_position INTEGER NOT NULL
);
`;
const RLAB_PROJECTIONS_SQL = `
CREATE TABLE IF NOT EXISTS projection_checkpoints (
  name TEXT PRIMARY KEY,
  global_position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS run_projection (
  run_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_global_position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_projection (
  conversation_id TEXT PRIMARY KEY,
  project_id TEXT,
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_global_position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_projection (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_global_position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_projection_conversation_position
ON message_projection(conversation_id, position);

CREATE TABLE IF NOT EXISTS workspace_projection (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_global_position INTEGER NOT NULL
);
`;

export type WorkspaceDbMutation = WorkspaceMutation;

export class WorkspaceRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super(`Workspace event position conflict: expected ${expectedRevision}, current ${currentRevision}.`);
    this.name = "WorkspaceRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export class EventStreamConflictError extends Error {
  readonly streamName: string;
  readonly expectedStreamVersion: number;
  readonly currentStreamVersion: number;

  constructor(streamName: string, expectedStreamVersion: number, currentStreamVersion: number) {
    super(`Event stream ${streamName} version conflict: expected ${expectedStreamVersion}, current ${currentStreamVersion}.`);
    this.name = "EventStreamConflictError";
    this.streamName = streamName;
    this.expectedStreamVersion = expectedStreamVersion;
    this.currentStreamVersion = currentStreamVersion;
  }
}

type StoredEventRow = {
  readonly stream_id: string;
  readonly stream_position: number;
  readonly message_type: string;
  readonly message_data: string;
  readonly message_metadata: string;
  readonly global_position: number;
};

type MessageRow = { readonly conversationId: string; readonly data: string };

interface HandledCommandEvent {
  readonly envelope: RlabCommandEnvelope;
  readonly streamName: string;
  readonly expectedStreamVersion: number;
  readonly event: RlabEvent;
}

export type RunProjectionStatus = "requested" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export interface RunProjection {
  readonly runId: string;
  readonly conversationId: string;
  readonly userMessageId?: string;
  readonly agentMessageId?: string;
  readonly requested?: RlabRunRequestedData;
  readonly startedAt?: string;
  readonly status: RunProjectionStatus;
  readonly events: readonly RunEvent[];
  readonly inputId?: string;
  readonly error?: string;
  readonly updatedGlobalPosition: string;
}

type RunLifecycleEvent = Extract<
  RlabEvent,
  | { readonly type: "run.requested" }
  | { readonly type: "run.started" }
  | { readonly type: "run.outputRecorded" }
  | { readonly type: "run.waitingForInput" }
  | { readonly type: "run.inputProvided" }
  | { readonly type: "run.completed" }
  | { readonly type: "run.failed" }
  | { readonly type: "run.cancelled" }
  | { readonly type: "run.interrupted" }
  | { readonly type: "run.rawBatchRecorded" }
>;
export type RunLifecycleEventInput = Omit<RunLifecycleEvent, "metadata">;

type EventSubscriber = (event: RecordedRlabEvent) => void;
const subscribers = new Set<EventSubscriber>();

export function subscribeWorkspaceEvents(subscriber: EventSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function database(): DatabaseHandle {
  if (!db) {
    throw new Error("Workspace event store is not initialised.");
  }
  return db;
}

function transaction<T>(run: () => T): T {
  const handle = database();
  handle.exec("BEGIN");
  try {
    const result = run();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // Surface the original error.
    }
    throw error;
  }
}

export function initWorkspaceDb(file: string): void {
  if (db) {
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec("PRAGMA foreign_keys = ON");
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  try {
    ensureNoLegacyWorkspaceSchema(handle);
    for (const sql of schemaSQL) {
      handle.exec(sql);
    }
    handle.exec(RLAB_COMMAND_RESULTS_SQL);
    handle.exec(RLAB_PROJECTIONS_SQL);
    db = handle;
    rebuildRlabProjections();
  } catch (error) {
    handle.close();
    throw error;
  }
}

function ensureNoLegacyWorkspaceSchema(handle: DatabaseHandle): void {
  const legacyTables = handle
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('projects', 'conversations', 'messages', 'composer_drafts', 'kv')`,
    )
    .all() as { readonly name: string }[];
  if (legacyTables.length > 0) {
    throw new Error("Workspace database schema is outdated; expected an event-sourced Emmett SQLite store.");
  }
}

export function closeWorkspaceDb(): void {
  if (db) {
    db.close();
    db = null;
  }
  subscribers.clear();
}

function readLastGlobalPositionFromHandle(handle: DatabaseHandle): number {
  const row = handle.prepare("SELECT COALESCE(MAX(global_position), 0) AS position FROM emt_messages WHERE partition = ? AND is_archived = 0").get(defaultTag) as
    | { position: number }
    | undefined;
  return row?.position ?? 0;
}

export function readWorkspaceRevision(): number {
  return readLastGlobalPositionFromHandle(database());
}

export function readWorkspaceCheckpoint(): string {
  return String(readWorkspaceRevision());
}

export function workspaceDbHasState(): boolean {
  const row = database().prepare("SELECT EXISTS(SELECT 1 FROM emt_messages WHERE partition = ? AND is_archived = 0) AS present").get(defaultTag) as { present: number };
  return row.present === 1;
}

function serverMetadata(commandId: string): RlabEventMetadata {
  return {
    schemaVersion: 1,
    commandId,
    clientId: "server",
    correlationId: commandId,
    createdAt: new Date().toISOString(),
  };
}

function streamType(streamName: string): string {
  const colon = streamName.indexOf(":");
  return colon > 0 ? streamName.slice(0, colon) : streamName;
}

function readStreamPosition(handle: DatabaseHandle, streamName: string): number {
  const row = handle
    .prepare("SELECT stream_position AS position FROM emt_streams WHERE stream_id = ? AND partition = ? AND is_archived = 0")
    .get(streamName, defaultTag) as { position: number } | undefined;
  return row?.position ?? 0;
}

function upsertStreamPosition(handle: DatabaseHandle, streamName: string, position: number): void {
  handle
    .prepare(
      `INSERT INTO emt_streams(stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
       VALUES(?, ?, ?, ?, '{}', 0)
       ON CONFLICT(stream_id, partition, is_archived)
       DO UPDATE SET stream_position = excluded.stream_position`,
    )
    .run(streamName, position, defaultTag, streamType(streamName));
}

function appendEventInTransaction(handle: DatabaseHandle, streamName: string, event: RlabEvent, expectedStreamVersion?: number): RecordedRlabEvent {
  const currentStreamVersion = readStreamPosition(handle, streamName);
  if (expectedStreamVersion !== undefined && currentStreamVersion !== expectedStreamVersion) {
    throw new EventStreamConflictError(streamName, expectedStreamVersion, currentStreamVersion);
  }
  const streamPosition = currentStreamVersion + 1;
  const globalPosition = readLastGlobalPositionFromHandle(handle) + 1;
  const messageId = randomUUID();
  const messageMetadata = {
    streamName,
    messageId,
    streamPosition: String(streamPosition),
    ...event.metadata,
  };
  handle
    .prepare(
      `INSERT INTO emt_messages(
        stream_id,
        stream_position,
        partition,
        message_kind,
        message_data,
        message_metadata,
        message_schema_version,
        message_type,
        message_id,
        is_archived,
        global_position
      ) VALUES(?, ?, ?, 'E', ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(streamName, streamPosition, defaultTag, JSON.stringify(event.data), JSON.stringify(messageMetadata), String(event.metadata.schemaVersion), event.type, messageId, globalPosition);
  upsertStreamPosition(handle, streamName, streamPosition);
  return {
    type: event.type,
    data: event.data,
    metadata: event.metadata,
    streamName,
    streamPosition: String(streamPosition),
    globalPosition: String(globalPosition),
  };
}

function publishRecordedEvents(events: readonly RecordedRlabEvent[]): void {
  if (events.length === 0 || subscribers.size === 0) {
    return;
  }
  for (const event of events) {
    for (const subscriber of subscribers) {
      subscriber(event);
    }
  }
}

function projectionCheckpoint(handle: DatabaseHandle, name: string): number {
  const row = handle.prepare("SELECT global_position AS position FROM projection_checkpoints WHERE name = ?").get(name) as { readonly position: number } | undefined;
  return row?.position ?? 0;
}

function setProjectionCheckpoint(handle: DatabaseHandle, name: string, position: number): void {
  handle
    .prepare(
      `INSERT INTO projection_checkpoints(name, global_position)
       VALUES(?, ?)
       ON CONFLICT(name) DO UPDATE SET global_position = excluded.global_position`,
    )
    .run(name, position);
}

function readRunProjectionInTransaction(handle: DatabaseHandle, runId: string): RunProjection | null {
  const row = handle.prepare("SELECT data FROM run_projection WHERE run_id = ?").get(runId) as { readonly data: string } | undefined;
  return row ? (JSON.parse(row.data) as RunProjection) : null;
}

function writeRunProjectionInTransaction(handle: DatabaseHandle, projection: RunProjection): void {
  handle
    .prepare(
      `INSERT INTO run_projection(run_id, conversation_id, status, data, updated_global_position)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         status = excluded.status,
         data = excluded.data,
         updated_global_position = excluded.updated_global_position`,
    )
    .run(projection.runId, projection.conversationId, projection.status, JSON.stringify(projection), Number(projection.updatedGlobalPosition));
}

function readWorkspaceProjectionInTransaction(handle: DatabaseHandle): WorkspaceState {
  const row = handle.prepare("SELECT data FROM workspace_projection WHERE name = 'workspace'").get() as { readonly data: string } | undefined;
  return row ? (JSON.parse(row.data) as WorkspaceState) : buildEmptyWorkspaceState();
}

function writeWorkspaceProjectionInTransaction(handle: DatabaseHandle, state: WorkspaceState, globalPosition: number): void {
  handle
    .prepare(
      `INSERT INTO workspace_projection(name, data, updated_global_position)
       VALUES('workspace', ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         data = excluded.data,
         updated_global_position = excluded.updated_global_position`,
    )
    .run(JSON.stringify(state), globalPosition);
}

function writeConversationProjectionRowsInTransaction(handle: DatabaseHandle, state: WorkspaceState, globalPosition: number): void {
  handle.prepare("DELETE FROM conversation_projection").run();
  let position = 0;
  const insert = handle.prepare(
    `INSERT INTO conversation_projection(conversation_id, project_id, position, data, updated_global_position)
     VALUES(?, ?, ?, ?, ?)`,
  );
  for (const conversation of state.chats) {
    insert.run(conversation.id, null, position, JSON.stringify(conversation), globalPosition);
    position += 1;
  }
  for (const project of state.projects) {
    for (const conversation of project.conversations) {
      insert.run(conversation.id, project.id, position, JSON.stringify(conversation), globalPosition);
      position += 1;
    }
  }
}

function writeThreadProjectionRowsInTransaction(handle: DatabaseHandle, conversationId: string, messages: readonly ChatMessage[], globalPosition: number): void {
  handle.prepare("DELETE FROM message_projection WHERE conversation_id = ?").run(conversationId);
  const insert = handle.prepare(
    `INSERT INTO message_projection(message_id, conversation_id, position, data, updated_global_position)
     VALUES(?, ?, ?, ?, ?)`,
  );
  messages.forEach((message, index) => {
    insert.run(message.id, conversationId, index, JSON.stringify(message), globalPosition);
  });
}

function writeAllMessageProjectionRowsInTransaction(handle: DatabaseHandle, state: WorkspaceState, globalPosition: number): void {
  handle.prepare("DELETE FROM message_projection").run();
  for (const [conversationId, messages] of Object.entries(state.threads)) {
    writeThreadProjectionRowsInTransaction(handle, conversationId, messages, globalPosition);
  }
}

function projectWorkspaceReadModelsInTransaction(handle: DatabaseHandle, event: RlabEvent, state: WorkspaceState, globalPosition: number): void {
  switch (event.type) {
    case "workspace.initialized":
      writeConversationProjectionRowsInTransaction(handle, state, globalPosition);
      writeAllMessageProjectionRowsInTransaction(handle, state, globalPosition);
      return;
    case "workspace.conversationUpserted":
    case "workspace.conversationUpdated":
      writeConversationProjectionRowsInTransaction(handle, state, globalPosition);
      return;
    case "workspace.conversationDeleted":
      writeConversationProjectionRowsInTransaction(handle, state, globalPosition);
      handle.prepare("DELETE FROM message_projection WHERE conversation_id = ?").run(event.data.conversationId);
      return;
    case "workspace.messageUpserted":
    case "workspace.messagesUpserted":
    case "workspace.conversationThreadReplaced":
    case "workspace.agentMessageUpsertedForUserTurn":
      writeThreadProjectionRowsInTransaction(handle, event.data.conversationId, state.threads[event.data.conversationId] ?? [], globalPosition);
      return;
    case "workspace.selectedConversationSet":
    case "workspace.settingsSet":
    case "workspace.projectUpserted":
    case "workspace.composerDraftSet":
    case "workspace.composerDraftDeleted":
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
      return;
  }
}

function projectWorkspaceEventInTransaction(handle: DatabaseHandle, recorded: RecordedRlabEvent): void {
  const position = Number.parseInt(recorded.globalPosition, 10);
  if (!Number.isFinite(position) || position <= projectionCheckpoint(handle, "workspace_projection")) {
    return;
  }
  const current = readWorkspaceProjectionInTransaction(handle);
  const event = toRlabEvent(recorded);
  const next = applyRlabEventToState(current, event);
  writeWorkspaceProjectionInTransaction(handle, next, position);
  projectWorkspaceReadModelsInTransaction(handle, event, next, position);
  setProjectionCheckpoint(handle, "workspace_projection", position);
}

function runProjectionFromRecordedEvent(event: RecordedRlabEvent): RunProjection | null {
  const globalPosition = event.globalPosition;
  switch (event.type) {
    case "run.requested": {
      const data = event.data as RlabRunRequestedData;
      return {
        runId: data.runId,
        conversationId: data.conversationId,
        userMessageId: data.userMessageId,
        agentMessageId: data.agentMessageId,
        requested: data,
        status: "requested",
        events: [],
        updatedGlobalPosition: globalPosition,
      };
    }
    default:
      return null;
  }
}

function projectRunEventInTransaction(handle: DatabaseHandle, recorded: RecordedRlabEvent): void {
  const position = Number.parseInt(recorded.globalPosition, 10);
  if (!Number.isFinite(position) || position <= projectionCheckpoint(handle, "run_projection")) {
    return;
  }
  const base = runProjectionFromRecordedEvent(recorded);
  if (base) {
    writeRunProjectionInTransaction(handle, base);
    setProjectionCheckpoint(handle, "run_projection", position);
    return;
  }
  const runData = "runId" in recorded.data && typeof recorded.data.runId === "string" ? recorded.data : null;
  if (!runData) {
    setProjectionCheckpoint(handle, "run_projection", position);
    return;
  }
  const current = readRunProjectionInTransaction(handle, runData.runId) ?? {
    runId: runData.runId,
    conversationId: "conversationId" in runData && typeof runData.conversationId === "string" ? runData.conversationId : "",
    status: "running",
    events: [],
    updatedGlobalPosition: recorded.globalPosition,
  } satisfies RunProjection;
  let next: RunProjection = { ...current, updatedGlobalPosition: recorded.globalPosition };
  switch (recorded.type) {
    case "run.started": {
      const data = recorded.data as RlabRunStartedData;
      next = {
        ...next,
        conversationId: data.conversationId,
        userMessageId: data.userMessageId,
        agentMessageId: data.agentMessageId,
        startedAt: data.startedAt,
        status: "running",
      };
      break;
    }
    case "run.outputRecorded": {
      const data = recorded.data as RlabRunOutputRecordedData;
      const output = data.event;
      const status: RunProjectionStatus = output.type === "approval" || output.type === "options" ? "waiting" : next.status === "requested" ? "running" : next.status;
      next = { ...next, conversationId: data.conversationId, status, events: [...next.events, output] };
      break;
    }
    case "run.waitingForInput": {
      const data = recorded.data as RlabRunWaitingForInputData;
      next = { ...next, conversationId: data.conversationId, status: "waiting", inputId: data.inputId };
      break;
    }
    case "run.inputProvided": {
      const data = recorded.data as RlabRunInputProvidedData;
      next = { ...next, conversationId: data.conversationId, status: "running", inputId: undefined };
      break;
    }
    case "run.completed": {
      const data = recorded.data as RlabRunCompletedData;
      next = {
        ...next,
        conversationId: data.conversationId,
        status: "completed",
        events: data.event ? [...next.events, data.event] : next.events,
      };
      break;
    }
    case "run.failed": {
      const data = recorded.data as RlabRunFailedData;
      next = { ...next, conversationId: data.conversationId, status: "failed", error: data.error };
      break;
    }
    case "run.cancelled": {
      const data = recorded.data as RlabRunCancelledData;
      next = { ...next, conversationId: data.conversationId, status: "cancelled" };
      break;
    }
    case "run.interrupted": {
      const data = recorded.data as RlabRunInterruptedData;
      next = { ...next, conversationId: data.conversationId, status: "failed", error: data.reason };
      break;
    }
    case "run.rawBatchRecorded": {
      const data = recorded.data as { readonly runId: string; readonly conversationId: string; readonly events: readonly RunEvent[] };
      next = { ...next, conversationId: data.conversationId, events: [...next.events, ...data.events] };
      break;
    }
  }
  writeRunProjectionInTransaction(handle, next);
  setProjectionCheckpoint(handle, "run_projection", position);
}

function projectRecordedEventInTransaction(handle: DatabaseHandle, recorded: RecordedRlabEvent): void {
  projectWorkspaceEventInTransaction(handle, recorded);
  projectRunEventInTransaction(handle, recorded);
}

function workspaceConversationIds(state: WorkspaceState): ReadonlySet<string> {
  return new Set([...state.chats, ...state.projects.flatMap((project) => project.conversations)].map((conversation) => conversation.id));
}

function ensureConversationExistsInState(state: WorkspaceState, conversationId: string): void {
  if (!workspaceConversationIds(state).has(conversationId)) {
    throw new Error(`Conversation ${conversationId} does not exist.`);
  }
}

function ensureProjectExistsInState(state: WorkspaceState, projectId: string): void {
  if (!state.projects.some((project) => project.id === projectId)) {
    throw new Error(`Project ${projectId} does not exist.`);
  }
}

function messageConversationId(state: WorkspaceState, messageId: string): string | undefined {
  for (const [conversationId, messages] of Object.entries(state.threads)) {
    if (messages.some((message) => message.id === messageId)) {
      return conversationId;
    }
  }
  return undefined;
}

function validateMessagesBelongToConversation(state: WorkspaceState, conversationId: string, messages: readonly ChatMessage[]): void {
  ensureConversationExistsInState(state, conversationId);
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) {
      throw new Error(`Duplicate message id ${message.id} in replacement thread.`);
    }
    seen.add(message.id);
    const existingConversationId = messageConversationId(state, message.id);
    if (existingConversationId !== undefined && existingConversationId !== conversationId) {
      throw new Error(`Message ${message.id} already belongs to conversation ${existingConversationId}.`);
    }
  }
}

function validateEventAgainstState(state: WorkspaceState, event: RlabEvent): void {
  switch (event.type) {
    case "workspace.initialized":
      if (workspaceDbHasState()) {
        throw new Error("Refusing to initialize a workspace event store that already has state.");
      }
      return;
    case "workspace.selectedConversationSet":
      if (event.data.conversationId) {
        ensureConversationExistsInState(state, event.data.conversationId);
      }
      return;
    case "workspace.conversationUpserted":
      if (event.data.projectId !== null) {
        ensureProjectExistsInState(state, event.data.projectId);
      }
      return;
    case "workspace.conversationUpdated":
      ensureConversationExistsInState(state, event.data.conversation.id);
      return;
    case "workspace.composerDraftSet":
      ensureConversationExistsInState(state, event.data.conversationId);
      return;
    case "workspace.messageUpserted":
      validateMessagesBelongToConversation(state, event.data.conversationId, [event.data.message]);
      return;
    case "workspace.messagesUpserted":
    case "workspace.conversationThreadReplaced":
      validateMessagesBelongToConversation(state, event.data.conversationId, event.data.messages);
      return;
    case "workspace.agentMessageUpsertedForUserTurn": {
      ensureConversationExistsInState(state, event.data.conversationId);
      const userMessage = state.threads[event.data.conversationId]?.find((message) => message.id === event.data.userMessageId);
      if (!userMessage) {
        throw new Error(`User message ${event.data.userMessageId} is missing from conversation ${event.data.conversationId}.`);
      }
      if (userMessage.role !== "user") {
        throw new Error(`Message ${event.data.userMessageId} is not a user message.`);
      }
      validateMessagesBelongToConversation(state, event.data.conversationId, [event.data.message]);
      return;
    }
    case "workspace.settingsSet":
    case "workspace.projectUpserted":
    case "workspace.conversationDeleted":
    case "workspace.composerDraftDeleted":
      return;
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
      ensureConversationExistsInState(state, event.data.conversationId);
      return;
  }
}

function validateEventsAgainstProjectedState(events: readonly { readonly event: RlabEvent }[]): void {
  let validationState = projectStateFromEvents();
  for (const { event } of events) {
    validateEventAgainstState(validationState, event);
    validationState = applyRlabEventToState(validationState, event);
  }
}

function appendEvents(events: readonly { readonly streamName: string; readonly event: RlabEvent }[]): RecordedRlabEvent[] {
  if (events.length === 0) {
    return [];
  }
  validateEventsAgainstProjectedState(events);
  const recorded = transaction(() => {
    const handle = database();
    const items = events.map(({ streamName, event }) => appendEventInTransaction(handle, streamName, event));
    for (const item of items) {
      projectRecordedEventInTransaction(handle, item);
    }
    return items;
  });
  publishRecordedEvents(recorded);
  return recorded;
}

function recordedEventFromRow(row: StoredEventRow): RecordedRlabEvent {
  const rawMetadata = JSON.parse(row.message_metadata) as Record<string, unknown>;
  const metadata: RlabEventMetadata = {
    schemaVersion: typeof rawMetadata.schemaVersion === "number" ? rawMetadata.schemaVersion : 1,
    commandId: typeof rawMetadata.commandId === "string" ? rawMetadata.commandId : "",
    clientId: typeof rawMetadata.clientId === "string" ? rawMetadata.clientId : "",
    correlationId: typeof rawMetadata.correlationId === "string" ? rawMetadata.correlationId : "",
    ...(typeof rawMetadata.causationId === "string" ? { causationId: rawMetadata.causationId } : {}),
    createdAt: typeof rawMetadata.createdAt === "string" ? rawMetadata.createdAt : "",
  };
  const event = parseRlabEvent({
    type: row.message_type,
    data: JSON.parse(row.message_data) as unknown,
    metadata,
  });
  return {
    type: event.type,
    data: event.data,
    metadata: event.metadata,
    streamName: row.stream_id,
    streamPosition: String(row.stream_position),
    globalPosition: String(row.global_position),
  };
}

export function readWorkspaceEventsAfter(position: string | number | bigint, limit = 500): RecordedRlabEvent[] {
  const numericPosition = typeof position === "bigint" ? Number(position) : typeof position === "number" ? position : Number.parseInt(position, 10);
  const after = Number.isFinite(numericPosition) ? Math.max(0, Math.trunc(numericPosition)) : 0;
  const rows = database()
    .prepare(
      `SELECT stream_id, stream_position, message_type, message_data, message_metadata, global_position
       FROM emt_messages
       WHERE partition = ? AND is_archived = 0 AND global_position > ?
       ORDER BY global_position
       LIMIT ?`,
    )
    .all(defaultTag, after, limit) as StoredEventRow[];
  return rows.map(recordedEventFromRow);
}

export function readAllWorkspaceEvents(): RecordedRlabEvent[] {
  return readWorkspaceEventsAfter(0, Number.MAX_SAFE_INTEGER);
}

export function readRunProjection(runId: string): RunProjection | null {
  return readRunProjectionInTransaction(database(), runId);
}

export function readRunProjections(statuses?: ReadonlySet<RunProjectionStatus>): RunProjection[] {
  const rows = database().prepare("SELECT data FROM run_projection ORDER BY updated_global_position").all() as { readonly data: string }[];
  const projections = rows.map((row) => JSON.parse(row.data) as RunProjection);
  return statuses ? projections.filter((projection) => statuses.has(projection.status)) : projections;
}

export function rebuildRlabProjections(): number {
  return transaction(() => {
    const handle = database();
    handle.prepare("DELETE FROM workspace_projection").run();
    handle.prepare("DELETE FROM conversation_projection").run();
    handle.prepare("DELETE FROM message_projection").run();
    handle.prepare("DELETE FROM run_projection").run();
    handle.prepare("DELETE FROM projection_checkpoints").run();
    const events = readAllWorkspaceEvents();
    for (const event of events) {
      projectRecordedEventInTransaction(handle, event);
    }
    return Number(events.at(-1)?.globalPosition ?? 0);
  });
}

function toRlabEvent(recorded: RecordedRlabEvent): RlabEvent {
  return {
    type: recorded.type,
    data: recorded.data,
    metadata: recorded.metadata,
  } as RlabEvent;
}

function projectStateFromEvents(): WorkspaceState {
  return readWorkspaceProjectionInTransaction(database());
}

function previewSnippetsFromLoadedThreads(threads: Readonly<Record<string, readonly ChatMessage[]>>): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(threads)
      .map(([conversationId, messages]) => [conversationId, conversationPreviewSnippet(messages, 60)] as const)
      .filter(([, snippet]) => snippet.length > 0),
  );
}

function readConversationPreviewSnippets(state: WorkspaceState): ReadonlyMap<string, string> {
  const snippets = new Map<string, string>();
  for (const conversation of [...state.chats, ...state.projects.flatMap((project) => project.conversations)]) {
    const rows = (state.threads[conversation.id] ?? []).slice(-PREVIEW_SNIPPET_LOOKBACK_MESSAGES).reverse();
    for (const message of rows) {
      const text = messagePreviewText(message);
      if (text.length > 0) {
        snippets.set(conversation.id, previewSnippet(text, 60));
        break;
      }
    }
  }
  return snippets;
}

function withConversationPreview(conversation: ConversationSummary, snippets: ReadonlyMap<string, string>): ConversationSummary {
  const snippet = snippets.get(conversation.id);
  return snippet === undefined || snippet === conversation.snippet ? conversation : { ...conversation, snippet };
}

function withPreviewSnippets(state: WorkspaceState, includeThreadIds?: ReadonlySet<string>): WorkspaceState {
  const snippets = includeThreadIds ? readConversationPreviewSnippets(state) : previewSnippetsFromLoadedThreads(state.threads);
  return {
    ...state,
    chats: state.chats.map((conversation) => withConversationPreview(conversation, snippets)),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.map((conversation) => withConversationPreview(conversation, snippets)),
    })),
  };
}

export function readWorkspaceStateFromDb(includeThreadIds?: ReadonlySet<string>): WorkspaceState {
  const fullState = withPreviewSnippets(projectStateFromEvents(), includeThreadIds);
  if (!includeThreadIds) {
    return fullState;
  }
  const threads: Record<string, ChatMessage[]> = {};
  for (const id of includeThreadIds) {
    if (Object.prototype.hasOwnProperty.call(fullState.threads, id)) {
      threads[id] = readThreadFromDb(id);
    }
  }
  return { ...fullState, threads };
}

export function initializeWorkspaceStateInDb(state: WorkspaceState): number {
  if (workspaceDbHasState()) {
    throw new Error("Refusing to initialize a workspace event store that already has state.");
  }
  const commandId = `initialize-${randomUUID()}`;
  const event: RlabEvent = {
    type: "workspace.initialized",
    data: { state: cloneWorkspaceState(state) },
    metadata: serverMetadata(commandId),
  };
  const recorded = appendEvents([{ streamName: "workspace", event }]);
  return Number(recorded.at(-1)?.globalPosition ?? 0);
}

function handleRlabCommandEnvelope(handle: DatabaseHandle, envelope: RlabCommandEnvelope, streamVersions: Map<string, number>): HandledCommandEvent | null {
  const existing = handle.prepare("SELECT global_position AS position FROM rlab_command_results WHERE command_id = ?").get(envelope.commandId) as
    | { position: number }
    | undefined;
  if (existing) {
    return null;
  }
  const streamName = commandStreamName(envelope.command);
  const expectedStreamVersion = streamVersions.get(streamName) ?? readStreamPosition(handle, streamName);
  streamVersions.set(streamName, expectedStreamVersion + 1);
  return {
    envelope,
    streamName,
    expectedStreamVersion,
    event: commandToEvent(envelope),
  };
}

export function appendRlabCommandEnvelopes(envelopes: readonly RlabCommandEnvelope[]): number {
  if (envelopes.length === 0) {
    return readWorkspaceRevision();
  }
  const handle = database();
  const recorded = transaction(() => {
    const streamVersions = new Map<string, number>();
    const commandIds = new Set<string>();
    const events: HandledCommandEvent[] = [];
    for (const envelope of envelopes) {
      if (commandIds.has(envelope.commandId)) {
        continue;
      }
      commandIds.add(envelope.commandId);
      const handled = handleRlabCommandEnvelope(handle, envelope, streamVersions);
      if (handled) {
        events.push(handled);
      }
    }
    if (events.length === 0) {
      return [];
    }
    validateEventsAgainstProjectedState(events);
    return events.map(({ envelope, streamName, event, expectedStreamVersion }) => {
      const item = appendEventInTransaction(handle, streamName, event, expectedStreamVersion);
      handle.prepare("INSERT INTO rlab_command_results(command_id, global_position) VALUES(?, ?)").run(envelope.commandId, Number(item.globalPosition));
      projectRecordedEventInTransaction(handle, item);
      return item;
    });
  });
  if (recorded.length === 0) {
    return readWorkspaceRevision();
  }
  publishRecordedEvents(recorded);
  return Number(recorded.at(-1)?.globalPosition ?? readWorkspaceRevision());
}

function runLifecycleCommandId(event: RunLifecycleEventInput): string {
  return `${event.type}-${event.data.runId}-${randomUUID()}`;
}

export function appendRunLifecycleEvent(input: RunLifecycleEventInput): number {
  const event = { ...input, metadata: serverMetadata(runLifecycleCommandId(input)) } as RunLifecycleEvent;
  const recorded = appendEvents([{ streamName: `run:${input.data.runId}`, event }]);
  return Number(recorded.at(-1)?.globalPosition ?? readWorkspaceRevision());
}

export function appendRunOutputEvent(runId: string, conversationId: string, event: RunEvent): number {
  return appendRunLifecycleEvent({ type: "run.outputRecorded", data: { runId, conversationId, event } });
}

export function applyWorkspaceDbMutations(
  mutations: readonly WorkspaceDbMutation[],
  options: { readonly expectedRevision?: number } = {},
): number {
  const current = readWorkspaceRevision();
  if (options.expectedRevision !== undefined && options.expectedRevision !== current) {
    throw new WorkspaceRevisionConflictError(options.expectedRevision, current);
  }
  const clientId = "server-legacy-adapter";
  return appendRlabCommandEnvelopes(
    mutations.map((mutation) => ({
      commandId: `mutation-${randomUUID()}`,
      clientId,
      command: workspaceMutationToCommand(mutation),
    })),
  );
}

export function readMessageBlocks(messageId: string): readonly AgentBlock[] | undefined {
  return readMessage(messageId)?.blocks;
}

export function readMessage(messageId: string): ChatMessage | undefined {
  const row = database().prepare("SELECT data FROM message_projection WHERE message_id = ?").get(messageId) as { readonly data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatMessage) : undefined;
}

export function upsertMessage(conversationId: string, message: ChatMessage): void {
  void appendRlabCommandEnvelopes([
    {
      commandId: `message-upsert-${randomUUID()}`,
      clientId: "server",
      command: { type: "workspace.upsertMessage", conversationId, message },
    },
  ]);
}

export function upsertAgentMessageForUserTurn(conversationId: string, userMessageId: string, message: ChatMessage): void {
  const commandId = `agent-message-upsert-${randomUUID()}`;
  appendEvents([
    {
      streamName: `conversation:${conversationId}`,
      event: {
        type: "workspace.agentMessageUpsertedForUserTurn",
        data: { conversationId, userMessageId, message },
        metadata: serverMetadata(commandId),
      },
    },
  ]);
}

export function readConversation(conversationId: string): ConversationSummary | undefined {
  const row = database().prepare("SELECT data FROM conversation_projection WHERE conversation_id = ?").get(conversationId) as { readonly data: string } | undefined;
  return row ? (JSON.parse(row.data) as ConversationSummary) : undefined;
}

export function updateConversationData(conversation: ConversationSummary): void {
  void appendRlabCommandEnvelopes([
    {
      commandId: `conversation-update-${randomUUID()}`,
      clientId: "server",
      command: { type: "workspace.updateConversation", conversation },
    },
  ]);
}

export function readSelectedConversationId(): string {
  return projectStateFromEvents().selectedId;
}

export function readThreadFromDb(conversationId: string): ChatMessage[] {
  const rows = database()
    .prepare("SELECT data FROM message_projection WHERE conversation_id = ? ORDER BY position")
    .all(conversationId) as { readonly data: string }[];
  return rows.map((row) => JSON.parse(row.data) as ChatMessage);
}

export function replaceThreadAfterAgentMessage(conversationId: string, userMessageId: string, message: ChatMessage): void {
  const state = projectStateFromEvents();
  const nextThread = upsertAgentMessageForUserTurnInThread(state.threads[conversationId] ?? [], userMessageId, message);
  void appendRlabCommandEnvelopes([
    {
      commandId: `thread-replace-${randomUUID()}`,
      clientId: "server",
      command: { type: "workspace.replaceConversationThread", conversationId, messages: nextThread },
    },
  ]);
}
