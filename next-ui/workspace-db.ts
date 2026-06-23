import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import type { AgentBlock, ChatMessage, ComposerDraft, ConversationSummary, Project } from "./src/domain/agent-types";
import type { AgentProfile } from "./src/lib/agent-catalog";
import { conversationPreviewSnippet, messagePreviewText, previewSnippet } from "./src/lib/conversation-preview";
import { collectMessageResources, type ConversationResource } from "./src/lib/conversation-resources";
import { inferConversationUpdatedAtMs, normalizeConversationUpdatedAtMs } from "./src/lib/time-format";
import { mergeConversationUpdate, type WorkspaceMutation } from "./src/lib/workspace-mutations";
import type { WorkspaceState } from "./src/lib/workspace-state";

// `node:sqlite` is an experimental built-in that bundlers (vite/vitest) refuse to
// resolve statically. Load it via the runtime accessor so neither the dev-server
// transform nor the prod config loader tries to bundle it. Same engine + types.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
type DatabaseHandle = InstanceType<typeof DatabaseSync>;

/**
 * SQLite-backed workspace storage. The workspace used to live in one JSON blob
 * that was rewritten in full on every change — a multi-MB sync `JSON.stringify`
 * per streamed agent token, which blocked the event loop and surfaced as Caddy
 * 502s. Here the tree is normalized into rows so the streaming hot path upserts
 * only the single changed message + conversation (≈KBs), while full-state reads/
 * writes (UI saves, seeding) reassemble/replace the tree in one WAL transaction.
 *
 * Uses the built-in `node:sqlite` (Node 22+) — no native dependency to compile.
 * The SQL is plain enough to swap to better-sqlite3 unchanged if ever needed.
 */

let db: DatabaseHandle | null = null;
const WORKSPACE_REVISION_KEY = "workspaceRevision";
const CONVERSATION_RESOURCES_BACKFILLED_KEY = "conversationResourcesBackfilled";
const PREVIEW_SNIPPET_LOOKBACK_MESSAGES = 20;

const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  message_position INTEGER NOT NULL,
  resource_index INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'link', 'file')),
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  time TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),
  UNIQUE(message_id, resource_index)
);
CREATE TABLE IF NOT EXISTS composer_drafts (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_queue_state (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pending_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  run_id TEXT,
  data TEXT NOT NULL,
  CHECK (state IN ('queued', 'dispatching'))
);
CREATE TABLE IF NOT EXISTS pending_queue_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  run_id TEXT,
  next_dispatch_at_ms INTEGER,
  data TEXT NOT NULL,
  CHECK (kind IN ('message', 'goal', 'wakeup')),
  CHECK (state IN ('queued', 'dispatching', 'paused', 'waiting_wakeup'))
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const INDEX_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_position ON projects(position);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_root_position ON conversations(position) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_position ON conversations(project_id, position) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_desc ON messages(conversation_id, position DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_position ON messages(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_conversation_resources_conversation ON conversation_resources(conversation_id, message_position, resource_index);
CREATE INDEX IF NOT EXISTS idx_conversation_resources_message ON conversation_resources(message_id);
CREATE INDEX IF NOT EXISTS idx_pending_turns_conversation ON pending_turns(conversation_id, state, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_turns_conversation_position ON pending_turns(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_pending_queue_items_conversation ON pending_queue_items(conversation_id, state, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_queue_items_conversation_position ON pending_queue_items(conversation_id, position);
`;

function tableExists(handle: DatabaseHandle, name: string): boolean {
  const row = handle.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { present: number } | undefined;
  return row !== undefined;
}

function tableHasForeignKeys(handle: DatabaseHandle, name: string): boolean {
  return (handle.prepare(`PRAGMA foreign_key_list(${name})`).all() as unknown[]).length > 0;
}

function assertForeignKeyIntegrity(handle: DatabaseHandle): void {
  const violations = handle.prepare("PRAGMA foreign_key_check").all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  if (violations.length > 0) {
    const first = violations[0];
    throw new Error(`Workspace database foreign key violation in ${first.table} row ${first.rowid} referencing ${first.parent}.`);
  }
}

function assertCurrentSchema(handle: DatabaseHandle): void {
  for (const table of ["projects", "conversations", "messages", "conversation_resources", "composer_drafts", "pending_queue_state", "pending_turns", "pending_queue_items", "kv"]) {
    if (!tableExists(handle, table)) {
      throw new Error(`Workspace database schema is incomplete: missing ${table}. Reset the workspace database.`);
    }
  }
  for (const table of ["conversations", "messages", "conversation_resources", "composer_drafts", "pending_queue_state", "pending_turns", "pending_queue_items"]) {
    if (!tableHasForeignKeys(handle, table)) {
      throw new Error(`Workspace database schema is outdated: ${table} has no declared foreign keys. Reset the workspace database.`);
    }
  }
}

function migratePendingTurnsToQueueItems(handle: DatabaseHandle): void {
  handle
    .prepare(
      `INSERT OR IGNORE INTO pending_queue_items(id, conversation_id, position, kind, created_at_ms, updated_at_ms, state, run_id, next_dispatch_at_ms, data)
       SELECT id, conversation_id, position, 'message', created_at_ms, created_at_ms, state, run_id, NULL, data
       FROM pending_turns`,
    )
    .run();
}

/** Open (or create) the workspace database in WAL mode. Idempotent. */
export function initWorkspaceDb(file: string): void {
  if (db) {
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  // WAL: concurrent readers + a single writer, no torn writes — this also kills
  // the "Storage state is locked" race the old lock-file approach hit.
  handle.exec("PRAGMA foreign_keys = ON");
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  try {
    handle.exec(TABLE_SCHEMA);
    handle.exec(INDEX_SCHEMA);
    assertCurrentSchema(handle);
    assertForeignKeyIntegrity(handle);
    migratePendingTurnsToQueueItems(handle);
    backfillConversationResourcesIfNeeded(handle);
    db = handle;
  } catch (error) {
    handle.close();
    throw error;
  }
}

function database(): DatabaseHandle {
  if (!db) {
    throw new Error("Workspace database is not initialised.");
  }
  return db;
}

function transaction(run: () => void): void {
  const handle = database();
  handle.exec("BEGIN");
  try {
    run();
    handle.exec("COMMIT");
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw error;
  }
}

function readWorkspaceRevisionFromHandle(handle: DatabaseHandle): number {
  const row = handle.prepare("SELECT value FROM kv WHERE key = ?").get(WORKSPACE_REVISION_KEY) as { value: string } | undefined;
  if (!row) {
    return 0;
  }
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
  } catch {
    return 0;
  }
}

function writeWorkspaceRevision(handle: DatabaseHandle, revision: number): void {
  handle
    .prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(WORKSPACE_REVISION_KEY, JSON.stringify(revision));
}

function bumpWorkspaceRevisionInTransaction(handle: DatabaseHandle): number {
  const next = readWorkspaceRevisionFromHandle(handle) + 1;
  writeWorkspaceRevision(handle, next);
  return next;
}

/** Monotonic workspace version used by /api/workspace optimistic concurrency. */
export function readWorkspaceRevision(): number {
  return readWorkspaceRevisionFromHandle(database());
}

type ProjectMeta = Omit<Project, "conversations">;
type MessageRow = { readonly conversationId: string; readonly data: string };
type MessagePageRow = { readonly position: number; readonly data: string };
type MessageWithIdRow = { readonly id: string; readonly conversationId: string; readonly position: number; readonly data: string };
type ExistingThreadMessageRow = { readonly id: string; readonly position: number };
type LatestUserMessageRow = { readonly conversationId: string; readonly data: string };
type ConversationResourceRow = {
  readonly kind: ConversationResource["kind"];
  readonly url: string;
  readonly label: string;
  readonly time: string | null;
  readonly origin: ConversationResource["origin"];
};

export type WorkspaceDbMutation = WorkspaceMutation;

export interface PendingTurnRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly message: ChatMessage;
  readonly origin: string;
}

export type PendingQueueItemKind = "message" | "goal" | "wakeup";
export type PendingQueueItemState = "queued" | "dispatching" | "paused" | "waiting_wakeup";

interface PendingQueueItemBase {
  readonly id: string;
  readonly conversationId: string;
  readonly position: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly state: PendingQueueItemState;
  readonly runId?: string;
  readonly nextDispatchAtMs?: number;
}

export interface PendingQueueMessageItem extends PendingQueueItemBase {
  readonly kind: "message";
  readonly message: ChatMessage;
  readonly origin: string;
}

export interface PendingQueueGoalItem extends PendingQueueItemBase {
  readonly kind: "goal";
  readonly description: string;
  readonly origin: string;
  readonly dispatchCount: number;
}

export interface PendingQueueWakeupItem extends PendingQueueItemBase {
  readonly kind: "wakeup";
  readonly wakeupId: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger?: unknown;
}

export type PendingQueueItem = PendingQueueMessageItem | PendingQueueGoalItem | PendingQueueWakeupItem;
export type PendingQueueDispatchItem = PendingQueueMessageItem | PendingQueueGoalItem;

export interface PendingTurnQueueSnapshot {
  readonly conversationId: string;
  readonly paused: boolean;
  readonly messages: readonly ChatMessage[];
  readonly items: readonly PendingQueueItem[];
}

export interface ConversationThreadPage {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreBefore: boolean;
  readonly nextBefore?: number;
}

interface PendingTurnStoredData {
  readonly message: ChatMessage;
  readonly origin: string;
}

interface PendingGoalStoredData {
  readonly description: string;
  readonly origin: string;
  readonly dispatchCount?: number;
}

interface PendingWakeupStoredData {
  readonly wakeupId: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger?: unknown;
}

type PendingTurnRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly data: string;
};

type PendingQueueItemRow = PendingTurnRow & {
  readonly position: number;
  readonly kind: PendingQueueItemKind;
  readonly updatedAtMs: number;
  readonly state: PendingQueueItemState;
  readonly runId: string | null;
  readonly nextDispatchAtMs: number | null;
};

export class WorkspaceRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super(`Workspace revision conflict: expected ${expectedRevision}, current ${currentRevision}.`);
    this.name = "WorkspaceRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

function projectMeta(project: Project): ProjectMeta {
  const { conversations: _conversations, ...meta } = project;
  return meta;
}

function messageFromRow(row: MessageRow): ChatMessage {
  return JSON.parse(row.data) as ChatMessage;
}

function insertMessageResourcesInTransaction(
  handle: DatabaseHandle,
  conversationId: string,
  messageId: string,
  messagePosition: number,
  message: ChatMessage,
): void {
  const resources = collectMessageResources(message);
  if (resources.length === 0) {
    return;
  }
  const insResource = handle.prepare(
    "INSERT INTO conversation_resources(conversation_id, message_id, message_position, resource_index, kind, url, label, time, origin) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  resources.forEach((resource, index) => {
    insResource.run(conversationId, messageId, messagePosition, index, resource.kind, resource.url, resource.label, resource.time ?? null, resource.origin);
  });
}

function replaceMessageResourcesInTransaction(
  handle: DatabaseHandle,
  conversationId: string,
  messageId: string,
  messagePosition: number,
  message: ChatMessage,
): void {
  handle.prepare("DELETE FROM conversation_resources WHERE message_id = ?").run(messageId);
  insertMessageResourcesInTransaction(handle, conversationId, messageId, messagePosition, message);
}

function rebuildConversationResourcesInTransaction(handle: DatabaseHandle, conversationId: string): void {
  handle.prepare("DELETE FROM conversation_resources WHERE conversation_id = ?").run(conversationId);
  const rows = handle.prepare("SELECT id, position, data FROM messages WHERE conversation_id = ? ORDER BY position").all(conversationId) as Array<{
    readonly id: string;
    readonly position: number;
    readonly data: string;
  }>;
  for (const row of rows) {
    insertMessageResourcesInTransaction(handle, conversationId, row.id, row.position, JSON.parse(row.data) as ChatMessage);
  }
}

function conversationResourceBackfillComplete(handle: DatabaseHandle): boolean {
  const row = handle.prepare("SELECT value FROM kv WHERE key = ?").get(CONVERSATION_RESOURCES_BACKFILLED_KEY) as { value: string } | undefined;
  return row?.value === "true";
}

function writeConversationResourceBackfillComplete(handle: DatabaseHandle): void {
  handle
    .prepare("INSERT INTO kv(key, value) VALUES(?, 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(CONVERSATION_RESOURCES_BACKFILLED_KEY);
}

function backfillConversationResourcesIfNeeded(handle: DatabaseHandle): void {
  if (conversationResourceBackfillComplete(handle)) {
    return;
  }
  const messageCount = (handle.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
  if (messageCount === 0) {
    return;
  }
  handle.exec("BEGIN");
  try {
    handle.prepare("DELETE FROM conversation_resources").run();
    const conversationRows = handle.prepare("SELECT id FROM conversations").all() as Array<{ readonly id: string }>;
    for (const row of conversationRows) {
      rebuildConversationResourcesInTransaction(handle, row.id);
    }
    writeConversationResourceBackfillComplete(handle);
    handle.exec("COMMIT");
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw error;
  }
}

function messageCreatedAtMs(message: ChatMessage): number | undefined {
  if (typeof message.createdAtMs === "number" && Number.isFinite(message.createdAtMs)) {
    return message.createdAtMs;
  }
  return undefined;
}

function messageThreadUpdatedAtMs(message: ChatMessage): number | undefined {
  let latest: number | undefined;
  const candidates = [message.createdAtMs, message.startedAtMs, inferConversationUpdatedAtMs(message.time)];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      latest = latest === undefined ? candidate : Math.max(latest, candidate);
    }
  }
  return latest;
}

function normalizeThreadUpdatedAtMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function latestThreadUpdatedAtMs(messages: readonly ChatMessage[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    const next = messageThreadUpdatedAtMs(message);
    if (next !== undefined) {
      latest = latest === undefined ? next : Math.max(latest, next);
    }
  }
  return latest;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function blockId(block: AgentBlock): string | undefined {
  const maybeBlock = block as AgentBlock & { readonly id?: unknown };
  return typeof maybeBlock.id === "string" ? maybeBlock.id : undefined;
}

function previewSnippetsFromLoadedThreads(threads: Readonly<Record<string, readonly ChatMessage[]>>): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(threads)
      .map(([conversationId, messages]) => [conversationId, conversationPreviewSnippet(messages, 60)] as const)
      .filter(([, snippet]) => snippet.length > 0),
  );
}

function withConversationPreview(
  conversation: ConversationSummary,
  snippets: ReadonlyMap<string, string>,
  latestThreadUpdatedAtMsByConversation: ReadonlyMap<string, number>,
): ConversationSummary {
  const snippet = snippets.get(conversation.id);
  const normalized = normalizeConversationActivityTimestamp(conversation);
  const threadUpdatedAtMs = normalizeThreadUpdatedAtMs(normalized.threadUpdatedAtMs) ?? latestThreadUpdatedAtMsByConversation.get(conversation.id);
  const withThreadMarker = threadUpdatedAtMs === undefined || threadUpdatedAtMs === normalized.threadUpdatedAtMs ? normalized : { ...normalized, threadUpdatedAtMs };
  return snippet === undefined || snippet === withThreadMarker.snippet ? withThreadMarker : { ...withThreadMarker, snippet };
}

function normalizeConversationActivityTimestamp(conversation: ConversationSummary): ConversationSummary {
  return {
    ...conversation,
    updatedAtMs: normalizeConversationUpdatedAtMs(conversation.time, conversation.updatedAtMs),
  };
}

function withInitialThreadUpdatedAt(conversation: ConversationSummary, messages: readonly ChatMessage[]): ConversationSummary {
  const normalized = normalizeConversationActivityTimestamp(conversation);
  const threadUpdatedAtMs = normalizeThreadUpdatedAtMs(normalized.threadUpdatedAtMs) ?? latestThreadUpdatedAtMs(messages);
  return threadUpdatedAtMs === undefined ? normalized : { ...normalized, threadUpdatedAtMs };
}

function readLatestUserMessageCreatedAtMsByConversation(handle: DatabaseHandle): ReadonlyMap<string, number> {
  const rows = handle
    .prepare(
      `
SELECT m.conversation_id AS conversationId, m.data
FROM messages m
JOIN (
  SELECT conversation_id, MAX(position) AS position
  FROM messages
  WHERE json_extract(data, '$.role') = 'user'
  GROUP BY conversation_id
) latest ON latest.conversation_id = m.conversation_id AND latest.position = m.position
`,
    )
    .all() as LatestUserMessageRow[];
  const byConversation = new Map<string, number>();
  for (const row of rows) {
    const createdAtMs = messageCreatedAtMs(messageFromRow(row));
    if (createdAtMs !== undefined) {
      byConversation.set(row.conversationId, createdAtMs);
    }
  }
  return byConversation;
}

function readLatestThreadUpdatedAtMsByConversation(handle: DatabaseHandle): ReadonlyMap<string, number> {
  const rows = handle
    .prepare(
      `
SELECT m.conversation_id AS conversationId, m.data
FROM messages m
JOIN (
  SELECT conversation_id, MAX(position) AS position
  FROM messages
  GROUP BY conversation_id
) latest ON latest.conversation_id = m.conversation_id AND latest.position = m.position
`,
    )
    .all() as MessageRow[];
  const byConversation = new Map<string, number>();
  for (const row of rows) {
    const updatedAtMs = messageThreadUpdatedAtMs(messageFromRow(row));
    if (updatedAtMs !== undefined) {
      byConversation.set(row.conversationId, updatedAtMs);
    }
  }
  return byConversation;
}

function sortConversationsByLatestUserMessage<T extends ConversationSummary>(
  conversations: readonly T[],
  latestUserMessageCreatedAtMs: ReadonlyMap<string, number>,
): T[] {
  return conversations
    .map((conversation, index) => ({
      conversation,
      index,
      activityAtMs: latestUserMessageCreatedAtMs.get(conversation.id) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) => right.activityAtMs - left.activityAtMs || left.index - right.index)
    .map((entry) => entry.conversation);
}

/** True once a workspace has been persisted — used to gate one-time import/seed. */
export function workspaceDbHasState(): boolean {
  const row = database().prepare("SELECT EXISTS(SELECT 1 FROM kv WHERE key = 'settings') AS present").get() as { present: number };
  return row.present === 1;
}

/** Reassemble the WorkspaceState tree from the normalized tables. With
 *  `includeThreadIds` only those conversations' message threads are loaded (the
 *  lazy "shell" the client gets first); omit it to load every thread. */
export function readWorkspaceStateFromDb(includeThreadIds?: ReadonlySet<string>): WorkspaceState {
  const handle = database();
  const projectRows = handle.prepare("SELECT id, data FROM projects ORDER BY position").all() as Array<{ id: string; data: string }>;
  const convRows = handle.prepare("SELECT project_id AS projectId, data FROM conversations ORDER BY position").all() as Array<{ projectId: string | null; data: string }>;
  const latestUserMessageCreatedAtMs = readLatestUserMessageCreatedAtMsByConversation(handle);
  const latestThreadUpdatedAtMsByConversation: ReadonlyMap<string, number> = includeThreadIds === undefined ? readLatestThreadUpdatedAtMsByConversation(handle) : new Map();
  const msgRows = (includeThreadIds
    ? [...includeThreadIds].flatMap((id) => handle.prepare("SELECT conversation_id AS conversationId, data FROM messages WHERE conversation_id = ? ORDER BY position").all(id))
    : handle.prepare("SELECT conversation_id AS conversationId, data FROM messages ORDER BY conversation_id, position").all()) as MessageRow[];
  const draftRows = handle.prepare("SELECT conversation_id AS conversationId, data FROM composer_drafts").all() as Array<{ conversationId: string; data: string }>;
  const kvRows = handle.prepare("SELECT key, value FROM kv").all() as Array<{ key: string; value: string }>;

  const convsByProject = new Map<string | null, ConversationSummary[]>();
  for (const row of convRows) {
    const list = convsByProject.get(row.projectId) ?? [];
    list.push(JSON.parse(row.data) as ConversationSummary);
    convsByProject.set(row.projectId, list);
  }
  const threads: Record<string, ChatMessage[]> = {};
  for (const row of msgRows) {
    (threads[row.conversationId] ??= []).push(messageFromRow(row));
  }
  const snippets = includeThreadIds ? new Map<string, string>() : previewSnippetsFromLoadedThreads(threads);
  const conversationsForProject = (projectId: string | null): ConversationSummary[] =>
    sortConversationsByLatestUserMessage(
      (convsByProject.get(projectId) ?? []).map((conversation) => withConversationPreview(conversation, snippets, latestThreadUpdatedAtMsByConversation)),
      latestUserMessageCreatedAtMs,
    );
  const projects: Project[] = projectRows.map((row) => ({
    ...(JSON.parse(row.data) as Omit<Project, "conversations">),
    conversations: conversationsForProject(row.id),
  }));
  const composerDrafts: Record<string, ComposerDraft> = {};
  for (const row of draftRows) {
    composerDrafts[row.conversationId] = JSON.parse(row.data) as ComposerDraft;
  }
  const kv = new Map(kvRows.map((row) => [row.key, row.value] as const));
  const selectedId = kv.has("selectedId") ? (JSON.parse(kv.get("selectedId") as string) as string) : "";
  const settings = JSON.parse(kv.get("settings") ?? "null") as WorkspaceState["settings"];
  return { chats: conversationsForProject(null), projects, threads, composerDrafts, selectedId, settings };
}

/** Seed an empty database. This is intentionally insert-only and refuses to run
 *  once a workspace exists; normal app writes must use WorkspaceDbMutation. */
export function initializeWorkspaceStateInDb(state: WorkspaceState): number {
  const handle = database();
  if (workspaceDbHasState()) {
    throw new Error("Refusing to initialize a workspace database that already has state.");
  }
  const nextRevision = readWorkspaceRevisionFromHandle(handle) + 1;
  transaction(() => {
    const insProject = handle.prepare("INSERT INTO projects(id, position, data) VALUES(?, ?, ?)");
    const insConv = handle.prepare("INSERT INTO conversations(id, project_id, position, data) VALUES(?, ?, ?, ?)");
    const insMsg = handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)");
    const insDraft = handle.prepare("INSERT INTO composer_drafts(conversation_id, data) VALUES(?, ?)");
    const insKv = handle.prepare("INSERT INTO kv(key, value) VALUES(?, ?)");
    state.chats.forEach((conversation, index) =>
      insConv.run(conversation.id, null, index, JSON.stringify(withInitialThreadUpdatedAt(conversation, state.threads[conversation.id] ?? []))),
    );
    state.projects.forEach((project, projectIndex) => {
      const { conversations, ...meta } = project;
      insProject.run(project.id, projectIndex, JSON.stringify(meta));
      conversations.forEach((conversation, index) =>
        insConv.run(conversation.id, project.id, index, JSON.stringify(withInitialThreadUpdatedAt(conversation, state.threads[conversation.id] ?? []))),
      );
    });
    for (const [conversationId, messages] of Object.entries(state.threads)) {
      messages.forEach((message, index) => {
        insMsg.run(message.id, conversationId, index, JSON.stringify(message));
        insertMessageResourcesInTransaction(handle, conversationId, message.id, index, message);
      });
    }
    for (const [conversationId, draft] of Object.entries(state.composerDrafts)) {
      insDraft.run(conversationId, JSON.stringify(draft));
    }
    insKv.run("selectedId", JSON.stringify(state.selectedId));
    insKv.run("settings", JSON.stringify(state.settings));
    writeConversationResourceBackfillComplete(handle);
    writeWorkspaceRevision(handle, nextRevision);
  });
  return nextRevision;
}

function projectWhere(projectId: string | null): string {
  return projectId === null ? "project_id IS NULL" : "project_id = ?";
}

function projectParams(projectId: string | null): readonly string[] {
  return projectId === null ? [] : [projectId];
}

function nextConversationPosition(handle: DatabaseHandle, projectId: string | null): number {
  return (handle.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM conversations WHERE ${projectWhere(projectId)}`).get(...projectParams(projectId)) as { next: number }).next;
}

function shiftConversationPositionsForFrontInsert(handle: DatabaseHandle, projectId: string | null): void {
  const where = projectWhere(projectId);
  const params = projectParams(projectId);
  const offset = (handle.prepare(`SELECT COALESCE(MAX(position), -1) + 2 AS offset FROM conversations WHERE ${where}`).get(...params) as { offset: number }).offset;
  handle.prepare(`UPDATE conversations SET position = position + ? WHERE ${where}`).run(offset, ...params);
  handle.prepare(`UPDATE conversations SET position = position - ? + 1 WHERE ${where}`).run(offset, ...params);
}

function shiftProjectPositionsForFrontInsert(handle: DatabaseHandle): void {
  const offset = (handle.prepare("SELECT COALESCE(MAX(position), -1) + 2 AS offset FROM projects").get() as { offset: number }).offset;
  handle.prepare("UPDATE projects SET position = position + ?").run(offset);
  handle.prepare("UPDATE projects SET position = position - ? + 1").run(offset);
}

function projectExists(handle: DatabaseHandle, projectId: string): boolean {
  const row = handle.prepare("SELECT 1 AS present FROM projects WHERE id = ?").get(projectId) as { present: number } | undefined;
  return row !== undefined;
}

function conversationExists(handle: DatabaseHandle, conversationId: string): boolean {
  const row = handle.prepare("SELECT 1 AS present FROM conversations WHERE id = ?").get(conversationId) as { present: number } | undefined;
  return row !== undefined;
}

function ensureProjectExists(handle: DatabaseHandle, projectId: string): void {
  if (!projectExists(handle, projectId)) {
    throw new Error(`Project ${projectId} does not exist.`);
  }
}

function ensureConversationExists(handle: DatabaseHandle, conversationId: string): void {
  if (!conversationExists(handle, conversationId)) {
    throw new Error(`Conversation ${conversationId} does not exist.`);
  }
}

function pendingTurnFromRow(row: PendingTurnRow): PendingTurnRecord {
  const data = JSON.parse(row.data) as PendingTurnStoredData;
  return {
    id: row.id,
    conversationId: row.conversationId,
    createdAtMs: row.createdAtMs,
    message: data.message,
    origin: data.origin,
  };
}

function maybeNumber(value: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pendingQueueItemBase(row: PendingQueueItemRow): PendingQueueItemBase {
  return {
    id: row.id,
    conversationId: row.conversationId,
    position: row.position,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
    state: row.state,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(maybeNumber(row.nextDispatchAtMs) === undefined ? {} : { nextDispatchAtMs: maybeNumber(row.nextDispatchAtMs) }),
  };
}

function pendingQueueItemFromRow(row: PendingQueueItemRow): PendingQueueItem {
  const base = pendingQueueItemBase(row);
  if (row.kind === "message") {
    const data = JSON.parse(row.data) as PendingTurnStoredData;
    return { ...base, kind: "message", message: data.message, origin: data.origin };
  }
  if (row.kind === "goal") {
    const data = JSON.parse(row.data) as PendingGoalStoredData;
    return {
      ...base,
      kind: "goal",
      description: data.description,
      origin: data.origin,
      dispatchCount: typeof data.dispatchCount === "number" && Number.isFinite(data.dispatchCount) ? Math.max(0, Math.trunc(data.dispatchCount)) : 0,
    };
  }
  const data = JSON.parse(row.data) as PendingWakeupStoredData;
  return {
    ...base,
    kind: "wakeup",
    wakeupId: data.wakeupId,
    prompt: data.prompt,
    ...(data.reason ? { reason: data.reason } : {}),
    ...(data.trigger === undefined ? {} : { trigger: data.trigger }),
  };
}

function pendingQueuePaused(handle: DatabaseHandle, conversationId: string): boolean {
  const row = handle.prepare("SELECT paused FROM pending_queue_state WHERE conversation_id = ?").get(conversationId) as { paused: number } | undefined;
  return row?.paused === 1;
}

function setPendingTurnQueuePausedInTransaction(handle: DatabaseHandle, conversationId: string, paused: boolean): void {
  ensureConversationExists(handle, conversationId);
  handle
    .prepare("INSERT INTO pending_queue_state(conversation_id, paused) VALUES(?, ?) ON CONFLICT(conversation_id) DO UPDATE SET paused = excluded.paused")
    .run(conversationId, paused ? 1 : 0);
}

function nextPendingTurnPosition(handle: DatabaseHandle, conversationId: string): number {
  return (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pending_turns WHERE conversation_id = ?").get(conversationId) as { next: number }).next;
}

function nextPendingQueueItemPosition(handle: DatabaseHandle, conversationId: string): number {
  return (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pending_queue_items WHERE conversation_id = ?").get(conversationId) as { next: number }).next;
}

function upsertProjectInTransaction(handle: DatabaseHandle, project: ProjectMeta, insertAtFront = false): void {
  const existing = handle.prepare("SELECT position FROM projects WHERE id = ?").get(project.id) as { position: number } | undefined;
  if (existing) {
    handle.prepare("UPDATE projects SET data = ? WHERE id = ?").run(JSON.stringify(project), project.id);
    return;
  }
  if (insertAtFront) {
    shiftProjectPositionsForFrontInsert(handle);
  }
  const position = insertAtFront ? 0 : (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM projects").get() as { next: number }).next;
  handle.prepare("INSERT INTO projects(id, position, data) VALUES(?, ?, ?)").run(project.id, position, JSON.stringify(project));
}

function upsertConversationInTransaction(handle: DatabaseHandle, conversation: ConversationSummary, projectId: string | null, insertAtFront = false): void {
  const normalizedConversation = normalizeConversationActivityTimestamp(conversation);
  if (projectId !== null) {
    ensureProjectExists(handle, projectId);
  }
  const existing = handle.prepare("SELECT project_id AS projectId, position FROM conversations WHERE id = ?").get(normalizedConversation.id) as { projectId: string | null; position: number } | undefined;
  if (existing && existing.projectId === projectId) {
    handle.prepare("UPDATE conversations SET data = ? WHERE id = ?").run(JSON.stringify(normalizedConversation), normalizedConversation.id);
    return;
  }
  if (existing) {
    handle.prepare("DELETE FROM conversations WHERE id = ?").run(normalizedConversation.id);
  }
  if (insertAtFront) {
    shiftConversationPositionsForFrontInsert(handle, projectId);
  }
  const position = insertAtFront ? 0 : nextConversationPosition(handle, projectId);
  handle.prepare("INSERT INTO conversations(id, project_id, position, data) VALUES(?, ?, ?, ?)").run(normalizedConversation.id, projectId, position, JSON.stringify(normalizedConversation));
}

function updateConversationInTransaction(handle: DatabaseHandle, conversation: ConversationSummary): void {
  const row = handle.prepare("SELECT data FROM conversations WHERE id = ?").get(conversation.id) as { data: string } | undefined;
  if (!row) {
    throw new Error(`Conversation ${conversation.id} does not exist.`);
  }
  const existing = JSON.parse(row.data) as ConversationSummary;
  const next = normalizeConversationActivityTimestamp(mergeConversationUpdate(existing, conversation));
  const result = handle.prepare("UPDATE conversations SET data = ? WHERE id = ?").run(JSON.stringify(next), conversation.id);
  if (result.changes === 0) {
    throw new Error(`Conversation ${conversation.id} does not exist.`);
  }
}

function touchConversationThreadInTransaction(handle: DatabaseHandle, conversationId: string, atMs = Date.now()): void {
  const row = handle.prepare("SELECT data FROM conversations WHERE id = ?").get(conversationId) as { data: string } | undefined;
  if (!row) {
    throw new Error(`Conversation ${conversationId} does not exist.`);
  }
  const conversation = JSON.parse(row.data) as ConversationSummary;
  const previous = normalizeThreadUpdatedAtMs(conversation.threadUpdatedAtMs);
  const threadUpdatedAtMs = previous === undefined ? atMs : Math.max(previous, atMs);
  updateConversationInTransaction(handle, { ...conversation, threadUpdatedAtMs });
}

function updateConversationProfileInTransaction(handle: DatabaseHandle, conversationId: string, profile: AgentProfile): void {
  const row = handle.prepare("SELECT data FROM conversations WHERE id = ?").get(conversationId) as { data: string } | undefined;
  if (!row) {
    throw new Error(`Conversation ${conversationId} does not exist.`);
  }
  const existing = JSON.parse(row.data) as ConversationSummary;
  const next = normalizeConversationActivityTimestamp({ ...existing, agent: profile.agent, profile });
  const result = handle.prepare("UPDATE conversations SET data = ? WHERE id = ?").run(JSON.stringify(next), conversationId);
  if (result.changes === 0) {
    throw new Error(`Conversation ${conversationId} does not exist.`);
  }
}

function upsertMessageInTransaction(handle: DatabaseHandle, conversationId: string, message: ChatMessage): void {
  ensureConversationExists(handle, conversationId);
  const existing = handle.prepare("SELECT conversation_id AS conversationId, position FROM messages WHERE id = ?").get(message.id) as { conversationId: string; position: number } | undefined;
  if (existing) {
    if (existing.conversationId !== conversationId) {
      throw new Error(`Message ${message.id} already belongs to conversation ${existing.conversationId}.`);
    }
    handle.prepare("UPDATE messages SET data = ? WHERE id = ?").run(JSON.stringify(message), message.id);
    replaceMessageResourcesInTransaction(handle, conversationId, message.id, existing.position, message);
    return;
  }
  const position = (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM messages WHERE conversation_id = ?").get(conversationId) as { next: number }).next;
  handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)").run(message.id, conversationId, position, JSON.stringify(message));
  insertMessageResourcesInTransaction(handle, conversationId, message.id, position, message);
}

function restartUserTurnInTransaction(handle: DatabaseHandle, conversationId: string, userMessage: ChatMessage): void {
  ensureConversationExists(handle, conversationId);
  if (userMessage.role !== "user") {
    throw new Error("Only user messages can restart a turn.");
  }
  const existing = handle.prepare("SELECT conversation_id AS conversationId, position, data FROM messages WHERE id = ?").get(userMessage.id) as
    | { conversationId: string; position: number; data: string }
    | undefined;
  if (!existing) {
    upsertMessageInTransaction(handle, conversationId, userMessage);
    return;
  }
  if (existing.conversationId !== conversationId) {
    throw new Error(`Message ${userMessage.id} already belongs to conversation ${existing.conversationId}.`);
  }
  const previous = JSON.parse(existing.data) as ChatMessage;
  if (previous.role !== "user") {
    throw new Error(`Message ${userMessage.id} is not a user message.`);
  }
  handle.prepare("UPDATE messages SET data = ? WHERE id = ?").run(JSON.stringify(userMessage), userMessage.id);
  handle.prepare("DELETE FROM messages WHERE conversation_id = ? AND position > ?").run(conversationId, existing.position);
  rebuildConversationResourcesInTransaction(handle, conversationId);
}

export function restartUserTurn(conversationId: string, userMessage: ChatMessage): void {
  const handle = database();
  transaction(() => {
    restartUserTurnInTransaction(handle, conversationId, userMessage);
    touchConversationThreadInTransaction(handle, conversationId);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

function replaceConversationThreadInTransaction(handle: DatabaseHandle, conversationId: string, messages: readonly ChatMessage[]): void {
  ensureConversationExists(handle, conversationId);
  const existingRows = handle.prepare("SELECT id, position FROM messages WHERE conversation_id = ? ORDER BY position").all(conversationId) as ExistingThreadMessageRow[];
  const existingPositions = new Map(existingRows.map((row) => [row.id, row.position] as const));
  const incomingIds = new Set(messages.map((message) => message.id));
  const incomingExistingIds = messages.filter((message) => existingPositions.has(message.id)).map((message) => message.id);
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) {
      throw new Error(`Duplicate message id ${message.id} in replacement thread.`);
    }
    seen.add(message.id);
    const existing = handle.prepare("SELECT conversation_id AS conversationId FROM messages WHERE id = ?").get(message.id) as { conversationId: string } | undefined;
    if (existing && existing.conversationId !== conversationId) {
      throw new Error(`Message ${message.id} already belongs to conversation ${existing.conversationId}.`);
    }
  }
  if (existingRows.length > 0) {
    if (messages[0]?.id !== existingRows[0]?.id) {
      throw new Error(`Refusing to replace conversation ${conversationId} with a partial thread page.`);
    }
    for (const row of existingRows) {
      if (!incomingIds.has(row.id)) {
        throw new Error(`Refusing to replace conversation ${conversationId} with a partial thread page.`);
      }
    }
    const existingIds = existingRows.map((row) => row.id);
    if (incomingExistingIds.length !== existingIds.length || incomingExistingIds.some((id, index) => id !== existingIds[index])) {
      throw new Error(`Refusing to replace conversation ${conversationId} with a reordered thread.`);
    }
  }
  handle.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  const insMsg = handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)");
  messages.forEach((message, index) => {
    insMsg.run(message.id, conversationId, index, JSON.stringify(message));
    insertMessageResourcesInTransaction(handle, conversationId, message.id, index, message);
  });
}

export function applyWorkspaceDbMutations(
  mutations: readonly WorkspaceDbMutation[],
  options: { readonly expectedRevision?: number } = {},
): number {
  const handle = database();
  let nextRevision = readWorkspaceRevisionFromHandle(handle);
  if (mutations.length === 0) {
    if (options.expectedRevision !== undefined && options.expectedRevision !== nextRevision) {
      throw new WorkspaceRevisionConflictError(options.expectedRevision, nextRevision);
    }
    return nextRevision;
  }
  transaction(() => {
    nextRevision = readWorkspaceRevisionFromHandle(handle);
    if (options.expectedRevision !== undefined && options.expectedRevision !== nextRevision) {
      throw new WorkspaceRevisionConflictError(options.expectedRevision, nextRevision);
    }
    for (const mutation of mutations) {
      switch (mutation.type) {
        case "setSelectedConversation":
          if (mutation.conversationId) {
            ensureConversationExists(handle, mutation.conversationId);
          }
          handle.prepare("INSERT INTO kv(key, value) VALUES('selectedId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(mutation.conversationId));
          if (mutation.conversationId) {
            const row = handle.prepare("SELECT data FROM conversations WHERE id = ?").get(mutation.conversationId) as { data: string } | undefined;
            if (row) {
              const conversation = JSON.parse(row.data) as ConversationSummary;
              updateConversationInTransaction(handle, { ...conversation, unread: false });
            }
          }
          break;
        case "setConversationProfile":
          updateConversationProfileInTransaction(handle, mutation.conversationId, mutation.profile);
          break;
        case "setSettings":
          handle.prepare("INSERT INTO kv(key, value) VALUES('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(mutation.settings));
          break;
        case "upsertProject":
          upsertProjectInTransaction(handle, mutation.project, mutation.insertAtFront);
          break;
        case "upsertConversation":
          upsertConversationInTransaction(handle, mutation.conversation, mutation.projectId, mutation.insertAtFront);
          break;
        case "updateConversation":
          updateConversationInTransaction(handle, mutation.conversation);
          break;
        case "deleteConversation":
          handle.prepare("DELETE FROM conversations WHERE id = ?").run(mutation.conversationId);
          handle.prepare("DELETE FROM messages WHERE conversation_id = ?").run(mutation.conversationId);
          handle.prepare("DELETE FROM composer_drafts WHERE conversation_id = ?").run(mutation.conversationId);
          break;
        case "setComposerDraft":
          ensureConversationExists(handle, mutation.conversationId);
          handle
            .prepare("INSERT INTO composer_drafts(conversation_id, data) VALUES(?, ?) ON CONFLICT(conversation_id) DO UPDATE SET data = excluded.data")
            .run(mutation.conversationId, JSON.stringify(mutation.draft));
          break;
        case "deleteComposerDraft":
          handle.prepare("DELETE FROM composer_drafts WHERE conversation_id = ?").run(mutation.conversationId);
          break;
        case "upsertMessage":
          upsertMessageInTransaction(handle, mutation.conversationId, mutation.message);
          touchConversationThreadInTransaction(handle, mutation.conversationId);
          break;
        case "upsertMessages":
          for (const message of mutation.messages) {
            upsertMessageInTransaction(handle, mutation.conversationId, message);
          }
          if (mutation.messages.length > 0) {
            touchConversationThreadInTransaction(handle, mutation.conversationId);
          }
          break;
        case "restartUserTurn":
          restartUserTurnInTransaction(handle, mutation.conversationId, mutation.userMessage);
          touchConversationThreadInTransaction(handle, mutation.conversationId);
          break;
        case "replaceConversationThread":
          replaceConversationThreadInTransaction(handle, mutation.conversationId, mutation.messages);
          touchConversationThreadInTransaction(handle, mutation.conversationId);
          break;
      }
    }
    nextRevision = bumpWorkspaceRevisionInTransaction(handle);
  });
  return nextRevision;
}

/** Blocks of a single agent message, for the streaming merge (hot path). */
export function readMessageBlocks(messageId: string): readonly AgentBlock[] | undefined {
  const row = database().prepare("SELECT data FROM messages WHERE id = ?").get(messageId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatMessage).blocks : undefined;
}

/** A single message row in full — for building a run-update without loading the
 *  whole workspace (the per-event notify hot path). */
export function readMessage(messageId: string): ChatMessage | undefined {
  const row = database().prepare("SELECT data FROM messages WHERE id = ?").get(messageId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatMessage) : undefined;
}

/** Read one interactive message block by its block id without loading the whole workspace. */
export function readMessageBlockById(blockIdToRead: string): AgentBlock | undefined {
  const rows = database()
    .prepare("SELECT data FROM messages WHERE data LIKE ? ESCAPE '\\'")
    .all(`%${escapeSqlLike(blockIdToRead)}%`) as Array<{ readonly data: string }>;
  for (const row of rows) {
    const message = JSON.parse(row.data) as ChatMessage;
    const block = message.blocks?.find((item) => blockId(item) === blockIdToRead);
    if (block) {
      return block;
    }
  }
  return undefined;
}

/** Upsert one message row (the streaming hot path). New messages append at the
 *  end of their conversation; existing ones update in place. */
export function upsertMessage(conversationId: string, message: ChatMessage): void {
  const handle = database();
  transaction(() => {
    upsertMessageInTransaction(handle, conversationId, message);
    touchConversationThreadInTransaction(handle, conversationId);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

/** Patch the single message block with this id. This is intentionally narrower
 * than loading a WorkspaceState: run approvals/options only need to update one
 * interactive block, not scan every loaded thread in the workspace tree. */
export function patchMessageBlockById(blockIdToPatch: string, updateBlock: (block: AgentBlock) => AgentBlock): readonly string[] {
  const handle = database();
  const rows = handle
    .prepare("SELECT id, conversation_id AS conversationId, position, data FROM messages WHERE data LIKE ? ESCAPE '\\'")
    .all(`%${escapeSqlLike(blockIdToPatch)}%`) as MessageWithIdRow[];
  const changedConversationIds = new Set<string>();
  transaction(() => {
    for (const row of rows) {
      const message = JSON.parse(row.data) as ChatMessage;
      if (!message.blocks?.some((block) => blockId(block) === blockIdToPatch)) {
        continue;
      }
      let changed = false;
      const blocks = message.blocks.map((block) => {
        if (blockId(block) !== blockIdToPatch) {
          return block;
        }
        const next = updateBlock(block);
        changed ||= next !== block;
        return next;
      });
      if (!changed) {
        continue;
      }
      const nextMessage = { ...message, blocks };
      handle.prepare("UPDATE messages SET data = ? WHERE id = ?").run(JSON.stringify(nextMessage), row.id);
      replaceMessageResourcesInTransaction(handle, row.conversationId, row.id, row.position, nextMessage);
      changedConversationIds.add(row.conversationId);
    }
    for (const conversationId of changedConversationIds) {
      const conversation = readConversation(conversationId);
      if (conversation) {
        updateConversationInTransaction(handle, { ...conversation, status: "running" });
        touchConversationThreadInTransaction(handle, conversationId);
      }
    }
    if (changedConversationIds.size > 0) {
      bumpWorkspaceRevisionInTransaction(handle);
    }
  });
  return [...changedConversationIds];
}

/** Upsert a bound agent reply immediately after its user message. Any stale
 *  non-user messages between that user turn and the next user turn are removed,
 *  which makes retries/reattached background runs converge in SQLite exactly the
 *  way the live in-memory thread does. */
export function upsertAgentMessageForUserTurn(conversationId: string, userMessageId: string, message: ChatMessage): void {
  const handle = database();
  if (message.role !== "agent") {
    throw new Error("Only agent messages can be upserted for a user turn.");
  }
  const existingAgent = handle.prepare("SELECT conversation_id AS conversationId FROM messages WHERE id = ?").get(message.id) as { conversationId: string } | undefined;
  if (existingAgent && existingAgent.conversationId !== conversationId) {
    throw new Error(`Message ${message.id} belongs to a different conversation.`);
  }
  const userRow = handle.prepare("SELECT position, data FROM messages WHERE conversation_id = ? AND id = ?").get(conversationId, userMessageId) as
    | { position: number; data: string }
    | undefined;
  if (!userRow) {
    throw new Error(`User message ${userMessageId} is missing from conversation ${conversationId}.`);
  }
  const userMessage = JSON.parse(userRow.data) as ChatMessage;
  if (userMessage.role !== "user") {
    throw new Error(`Message ${userMessageId} is not a user message.`);
  }
  const laterRows = handle.prepare("SELECT position, data FROM messages WHERE conversation_id = ? AND position > ? ORDER BY position").all(conversationId, userRow.position) as Array<{
    position: number;
    data: string;
  }>;
  const nextUserPosition = laterRows.find((row) => (JSON.parse(row.data) as ChatMessage).role === "user")?.position;
  transaction(() => {
    handle.prepare("DELETE FROM messages WHERE id = ?").run(message.id);
    if (nextUserPosition === undefined) {
      handle.prepare("DELETE FROM messages WHERE conversation_id = ? AND position > ?").run(conversationId, userRow.position);
    } else {
      handle.prepare("DELETE FROM messages WHERE conversation_id = ? AND position > ? AND position < ?").run(conversationId, userRow.position, nextUserPosition);
      if (nextUserPosition === userRow.position + 1) {
        handle.prepare("UPDATE messages SET position = position + 1 WHERE conversation_id = ? AND position >= ?").run(conversationId, nextUserPosition);
      }
    }
    handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)").run(message.id, conversationId, userRow.position + 1, JSON.stringify(message));
    rebuildConversationResourcesInTransaction(handle, conversationId);
    touchConversationThreadInTransaction(handle, conversationId);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

/** Read a single conversation summary (hot path: patch status without loading
 *  the whole workspace). */
export function readConversation(conversationId: string): ConversationSummary | undefined {
  const row = database().prepare("SELECT data FROM conversations WHERE id = ?").get(conversationId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ConversationSummary) : undefined;
}

/** Update a single conversation's summary in place (keeps its position/project). */
export function updateConversationData(conversation: ConversationSummary): void {
  const handle = database();
  transaction(() => {
    updateConversationInTransaction(handle, conversation);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

export function readPendingTurnQueue(conversationId: string): PendingTurnQueueSnapshot {
  const handle = database();
  ensureConversationExists(handle, conversationId);
  const rows = handle
    .prepare(
      `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
       FROM pending_queue_items
       WHERE conversation_id = ? AND state != 'dispatching'
       ORDER BY position`,
    )
    .all(conversationId) as PendingQueueItemRow[];
  const items = rows.map((row) => pendingQueueItemFromRow(row));
  return {
    conversationId,
    paused: pendingQueuePaused(handle, conversationId),
    messages: items.filter((item): item is PendingQueueMessageItem => item.kind === "message" && item.state === "queued").map((item) => item.message),
    items,
  };
}

export function readPendingQueueConversationIds(): readonly string[] {
  const rows = database()
    .prepare("SELECT DISTINCT conversation_id AS conversationId FROM pending_queue_items WHERE state IN ('queued', 'waiting_wakeup') ORDER BY conversation_id")
    .all() as Array<{ conversationId: string }>;
  return rows.map((row) => row.conversationId);
}

export function readPendingQueueHead(conversationId: string): PendingQueueItem | null {
  const handle = database();
  ensureConversationExists(handle, conversationId);
  const row = handle
    .prepare(
      `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
       FROM pending_queue_items
       WHERE conversation_id = ? AND state IN ('queued', 'waiting_wakeup')
       ORDER BY position LIMIT 1`,
    )
    .get(conversationId) as PendingQueueItemRow | undefined;
  return row ? pendingQueueItemFromRow(row) : null;
}

export function enqueuePendingTurn(record: PendingTurnRecord): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, record.conversationId);
    const message = record.message.createdAtMs === undefined ? { ...record.message, createdAtMs: record.createdAtMs } : record.message;
    const data: PendingTurnStoredData = { message, origin: record.origin };
    handle
      .prepare("INSERT INTO pending_queue_items(id, conversation_id, position, kind, created_at_ms, updated_at_ms, state, run_id, next_dispatch_at_ms, data) VALUES(?, ?, ?, 'message', ?, ?, 'queued', NULL, NULL, ?)")
      .run(record.id, record.conversationId, nextPendingQueueItemPosition(handle, record.conversationId), record.createdAtMs, record.createdAtMs, JSON.stringify(data));
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(record.conversationId);
}

export function enqueuePendingGoal(record: {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly description: string;
  readonly origin: string;
}): PendingTurnQueueSnapshot {
  const description = record.description.trim();
  if (!description) {
    throw new Error("Goal description is required.");
  }
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, record.conversationId);
    const data: PendingGoalStoredData = { description, origin: record.origin, dispatchCount: 0 };
    handle
      .prepare("INSERT INTO pending_queue_items(id, conversation_id, position, kind, created_at_ms, updated_at_ms, state, run_id, next_dispatch_at_ms, data) VALUES(?, ?, ?, 'goal', ?, ?, 'queued', NULL, NULL, ?)")
      .run(record.id, record.conversationId, nextPendingQueueItemPosition(handle, record.conversationId), record.createdAtMs, record.createdAtMs, JSON.stringify(data));
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(record.conversationId);
}

export function upsertPendingWakeupItem(record: {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger?: unknown;
}): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, record.conversationId);
    const existing = handle.prepare("SELECT position FROM pending_queue_items WHERE id = ?").get(record.id) as { position: number } | undefined;
    const data: PendingWakeupStoredData = {
      wakeupId: record.id,
      prompt: record.prompt,
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.trigger === undefined ? {} : { trigger: record.trigger }),
    };
    if (existing) {
      handle
        .prepare("UPDATE pending_queue_items SET updated_at_ms = ?, state = 'waiting_wakeup', run_id = NULL, next_dispatch_at_ms = NULL, data = ? WHERE id = ? AND kind = 'wakeup'")
        .run(Date.now(), JSON.stringify(data), record.id);
    } else {
      handle
        .prepare("INSERT INTO pending_queue_items(id, conversation_id, position, kind, created_at_ms, updated_at_ms, state, run_id, next_dispatch_at_ms, data) VALUES(?, ?, ?, 'wakeup', ?, ?, 'waiting_wakeup', NULL, NULL, ?)")
        .run(record.id, record.conversationId, nextPendingQueueItemPosition(handle, record.conversationId), record.createdAtMs, record.createdAtMs, JSON.stringify(data));
    }
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(record.conversationId);
}

export function removePendingTurn(conversationId: string, messageId: string): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    handle.prepare("DELETE FROM pending_queue_items WHERE conversation_id = ? AND id = ? AND kind = 'message' AND state = 'queued'").run(conversationId, messageId);
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(conversationId);
}

export function removePendingQueueItem(conversationId: string, itemId: string): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    const result = handle.prepare("DELETE FROM pending_queue_items WHERE conversation_id = ? AND id = ? AND state != 'dispatching'").run(conversationId, itemId);
    if (result.changes === 0) {
      throw new Error("Queue item not found.");
    }
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(conversationId);
}

export function setPendingQueueItemPaused(conversationId: string, itemId: string, paused: boolean): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    const nextState: PendingQueueItemState = paused ? "paused" : "queued";
    const result = handle.prepare("UPDATE pending_queue_items SET state = ?, updated_at_ms = ? WHERE conversation_id = ? AND id = ? AND kind = 'goal' AND state IN ('queued', 'paused')").run(nextState, Date.now(), conversationId, itemId);
    if (result.changes === 0) {
      throw new Error("Goal not found.");
    }
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(conversationId);
}

export function updatePendingGoal(
  conversationId: string,
  itemId: string,
  patch: { readonly description?: string; readonly afterItemId?: string | null },
): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    const row = handle
      .prepare(
        `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
         FROM pending_queue_items WHERE conversation_id = ? AND id = ? AND kind = 'goal' AND state != 'dispatching'`,
      )
      .get(conversationId, itemId) as PendingQueueItemRow | undefined;
    if (!row) {
      throw new Error("Goal not found.");
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (!description) {
        throw new Error("Goal description is required.");
      }
      const data = JSON.parse(row.data) as PendingGoalStoredData;
      handle.prepare("UPDATE pending_queue_items SET data = ?, updated_at_ms = ? WHERE conversation_id = ? AND id = ?").run(JSON.stringify({ ...data, description }), Date.now(), conversationId, itemId);
    }
    bumpWorkspaceRevisionInTransaction(handle);
  });
  if (patch.afterItemId !== undefined) {
    return movePendingQueueItemAfter(conversationId, itemId, patch.afterItemId);
  }
  return readPendingTurnQueue(conversationId);
}

export function movePendingQueueItemAfter(conversationId: string, itemId: string, afterItemId: string | null): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    const rows = handle
      .prepare("SELECT id FROM pending_queue_items WHERE conversation_id = ? AND state != 'dispatching' ORDER BY position")
      .all(conversationId) as Array<{ id: string }>;
    if (!rows.some((row) => row.id === itemId)) {
      throw new Error("Queue item not found.");
    }
    const ids = rows.map((row) => row.id).filter((id) => id !== itemId);
    const insertAt = afterItemId ? ids.indexOf(afterItemId) + 1 : 0;
    const safeInsertAt = insertAt <= 0 ? 0 : Math.min(insertAt, ids.length);
    ids.splice(safeInsertAt, 0, itemId);
    ids.forEach((id, index) => {
      handle.prepare("UPDATE pending_queue_items SET position = ?, updated_at_ms = ? WHERE conversation_id = ? AND id = ?").run(1_000_000 + index, Date.now(), conversationId, id);
    });
    ids.forEach((id, index) => {
      handle.prepare("UPDATE pending_queue_items SET position = ?, updated_at_ms = ? WHERE conversation_id = ? AND id = ?").run(index, Date.now(), conversationId, id);
    });
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(conversationId);
}

export function setPendingTurnQueuePaused(conversationId: string, paused: boolean): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    setPendingTurnQueuePausedInTransaction(handle, conversationId, paused);
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(conversationId);
}

export function claimNextPendingTurn(conversationId: string, runId: string): PendingTurnRecord | null {
  const claimed = claimNextPendingQueueItem(conversationId, runId);
  return claimed?.kind === "message" ? { id: claimed.id, conversationId: claimed.conversationId, createdAtMs: claimed.createdAtMs, message: claimed.message, origin: claimed.origin } : null;
}

export function claimNextPendingQueueItem(conversationId: string, runId: string, nowMs = Date.now()): PendingQueueDispatchItem | null {
  const handle = database();
  let claimed: PendingQueueDispatchItem | null = null;
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    if (pendingQueuePaused(handle, conversationId)) {
      return;
    }
    const row = handle
      .prepare(
        `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
         FROM pending_queue_items
         WHERE conversation_id = ? AND state IN ('queued', 'waiting_wakeup')
         ORDER BY position LIMIT 1`,
      )
      .get(conversationId) as PendingQueueItemRow | undefined;
    if (!row || row.kind === "wakeup" || row.state !== "queued" || (row.nextDispatchAtMs !== null && row.nextDispatchAtMs > nowMs)) {
      return;
    }
    const result = handle.prepare("UPDATE pending_queue_items SET state = 'dispatching', run_id = ?, updated_at_ms = ? WHERE id = ? AND state = 'queued'").run(runId, nowMs, row.id);
    if (result.changes === 1) {
      const item = pendingQueueItemFromRow({ ...row, state: "dispatching", runId, updatedAtMs: nowMs });
      if (item.kind === "message" || item.kind === "goal") {
        claimed = item;
      }
      bumpWorkspaceRevisionInTransaction(handle);
    }
  });
  return claimed;
}

export function deletePendingTurn(id: string): void {
  const handle = database();
  transaction(() => {
    handle.prepare("DELETE FROM pending_queue_items WHERE id = ?").run(id);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

export function releasePendingTurn(id: string, options: { readonly pause: boolean }): PendingTurnRecord | null {
  const released = releasePendingQueueItem(id, { pause: options.pause });
  return released?.kind === "message" ? { id: released.id, conversationId: released.conversationId, createdAtMs: released.createdAtMs, message: released.message, origin: released.origin } : null;
}

export function releasePendingQueueItem(
  id: string,
  options: { readonly pause: boolean; readonly rotateToEnd?: boolean; readonly nextDispatchAtMs?: number },
): PendingQueueDispatchItem | null {
  const handle = database();
  let released: PendingQueueDispatchItem | null = null;
  transaction(() => {
    const row = handle
      .prepare(
        `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
         FROM pending_queue_items WHERE id = ?`,
      )
      .get(id) as PendingQueueItemRow | undefined;
    if (!row) {
      return;
    }
    const item = pendingQueueItemFromRow(row);
    if (item.kind !== "message" && item.kind !== "goal") {
      return;
    }
    const nextState: PendingQueueItemState = item.kind === "goal" && options.pause ? "paused" : "queued";
    const nextPosition = options.rotateToEnd ? nextPendingQueueItemPosition(handle, row.conversationId) : row.position;
    let nextData = row.data;
    if (item.kind === "goal") {
      const data = JSON.parse(row.data) as PendingGoalStoredData;
      nextData = JSON.stringify({ ...data, dispatchCount: item.dispatchCount + 1 });
    }
    handle
      .prepare("UPDATE pending_queue_items SET state = ?, run_id = NULL, position = ?, updated_at_ms = ?, next_dispatch_at_ms = ?, data = ? WHERE id = ?")
      .run(nextState, nextPosition, Date.now(), options.nextDispatchAtMs ?? null, nextData, id);
    if (options.pause) {
      setPendingTurnQueuePausedInTransaction(handle, row.conversationId, true);
    }
    const nextRow = { ...row, state: nextState, runId: null, position: nextPosition, updatedAtMs: Date.now(), nextDispatchAtMs: options.nextDispatchAtMs ?? null, data: nextData };
    const nextItem = pendingQueueItemFromRow(nextRow);
    if (nextItem.kind === "message" || nextItem.kind === "goal") {
      released = nextItem;
    }
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return released;
}

export function releaseDispatchingQueueItemByRunId(
  runId: string,
  options: { readonly pause: boolean; readonly rotateToEnd?: boolean; readonly nextDispatchAtMs?: number },
): PendingQueueDispatchItem | null {
  const handle = database();
  const row = handle
    .prepare(
      `SELECT id, conversation_id AS conversationId, position, kind, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs, state, run_id AS runId, next_dispatch_at_ms AS nextDispatchAtMs, data
       FROM pending_queue_items WHERE run_id = ? AND state = 'dispatching' LIMIT 1`,
    )
    .get(runId) as PendingQueueItemRow | undefined;
  return row ? releasePendingQueueItem(row.id, options) : null;
}

export function resetDispatchingPendingTurns(): void {
  const handle = database();
  transaction(() => {
    const rows = handle.prepare("SELECT DISTINCT conversation_id AS conversationId FROM pending_queue_items WHERE state = 'dispatching'").all() as Array<{ conversationId: string }>;
    const result = handle.prepare("UPDATE pending_queue_items SET state = 'queued', run_id = NULL WHERE state = 'dispatching'").run();
    if (result.changes > 0) {
      for (const row of rows) {
        setPendingTurnQueuePausedInTransaction(handle, row.conversationId, true);
      }
      bumpWorkspaceRevisionInTransaction(handle);
    }
  });
}

/** The persisted selected conversation id (so the client shell can ship its
 *  thread eagerly). Cheap single-row read. */
export function readSelectedConversationId(): string {
  const row = database().prepare("SELECT value FROM kv WHERE key = 'selectedId'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string) : "";
}

/** Load a single conversation's full message thread (lazy-load on open). */
export function readThreadFromDb(conversationId: string): ChatMessage[] {
  return (database().prepare("SELECT data FROM messages WHERE conversation_id = ? ORDER BY position").all(conversationId) as Array<{ data: string }>).map(
    (row) => JSON.parse(row.data) as ChatMessage,
  );
}

/** Read precomputed conversation resources without loading or parsing message bodies. */
export function readConversationResourcesFromDb(conversationId: string): ConversationResource[] {
  const handle = database();
  ensureConversationExists(handle, conversationId);
  const rows = handle
    .prepare(
      `
SELECT kind, url, label, time, origin
FROM conversation_resources
WHERE conversation_id = ?
ORDER BY message_position, resource_index, id
`,
    )
    .all(conversationId) as ConversationResourceRow[];
  const seen = new Set<string>();
  const resources: ConversationResource[] = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resources.push({
      id: `res-${resources.length + 1}`,
      kind: row.kind,
      url: row.url,
      label: row.label,
      origin: row.origin,
      ...(row.time === null ? {} : { time: row.time }),
    });
  }
  return resources;
}

export function readThreadPageFromDb(conversationId: string, options: { readonly before?: number; readonly limit: number }): ConversationThreadPage {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
  const before = typeof options.before === "number" && Number.isFinite(options.before) ? Math.trunc(options.before) : undefined;
  const rows = (before === undefined
    ? database().prepare("SELECT position, data FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT ?").all(conversationId, limit + 1)
    : database().prepare("SELECT position, data FROM messages WHERE conversation_id = ? AND position < ? ORDER BY position DESC LIMIT ?").all(conversationId, before, limit + 1)) as MessagePageRow[];
  const pageRows = rows.slice(0, limit).reverse();
  const messages = pageRows.map((row) => JSON.parse(row.data) as ChatMessage);
  const first = pageRows[0];
  return {
    messages,
    hasMoreBefore: rows.length > limit,
    nextBefore: first ? first.position : undefined,
  };
}

function searchableConversationText(conversation: ConversationSummary): string {
  return [conversation.title, conversation.snippet, conversation.agent, conversation.time].join("\n").toLowerCase();
}

function searchableMessageText(message: ChatMessage): string {
  return messagePreviewText(message).toLowerCase();
}

/** Server-side conversation search. It intentionally returns ids only: the
 * client already has ordered summaries from the lightweight workspace shell, and
 * keeping message bodies server-side avoids the old load-all-threads path. */
export function searchConversationIds(query: string, limit = 100): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const handle = database();
  const found = new Set<string>();
  const conversationRows = handle.prepare("SELECT id, data FROM conversations ORDER BY position").all() as Array<{ id: string; data: string }>;
  for (const row of conversationRows) {
    if (found.size >= limit) {
      break;
    }
    const conversation = JSON.parse(row.data) as ConversationSummary;
    if (searchableConversationText(conversation).includes(normalized)) {
      found.add(row.id);
    }
  }
  if (found.size >= limit) {
    return [...found];
  }
  const messageRows = handle.prepare("SELECT conversation_id AS conversationId, data FROM messages ORDER BY conversation_id, position").all() as MessageRow[];
  for (const row of messageRows) {
    if (found.size >= limit) {
      break;
    }
    if (found.has(row.conversationId)) {
      continue;
    }
    if (searchableMessageText(messageFromRow(row)).includes(normalized)) {
      found.add(row.conversationId);
    }
  }
  return [...found];
}

export function closeWorkspaceDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
