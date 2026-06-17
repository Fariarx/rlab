import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import type { AgentBlock, ChatMessage, ComposerDraft, ConversationSummary, Project } from "./src/domain/agent-types";
import type { AgentProfile } from "./src/lib/agent-catalog";
import { conversationPreviewSnippet, messagePreviewText, previewSnippet } from "./src/lib/conversation-preview";
import { normalizeConversationUpdatedAtMs } from "./src/lib/time-format";
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
CREATE INDEX IF NOT EXISTS idx_pending_turns_conversation ON pending_turns(conversation_id, state, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_turns_conversation_position ON pending_turns(conversation_id, position);
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
  for (const table of ["projects", "conversations", "messages", "composer_drafts", "pending_queue_state", "pending_turns", "kv"]) {
    if (!tableExists(handle, table)) {
      throw new Error(`Workspace database schema is incomplete: missing ${table}. Reset the workspace database.`);
    }
  }
  for (const table of ["conversations", "messages", "composer_drafts", "pending_queue_state", "pending_turns"]) {
    if (!tableHasForeignKeys(handle, table)) {
      throw new Error(`Workspace database schema is outdated: ${table} has no declared foreign keys. Reset the workspace database.`);
    }
  }
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

export type WorkspaceDbMutation = WorkspaceMutation;

export interface PendingTurnRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly message: ChatMessage;
  readonly origin: string;
}

export interface PendingTurnQueueSnapshot {
  readonly conversationId: string;
  readonly paused: boolean;
  readonly messages: readonly ChatMessage[];
}

interface PendingTurnStoredData {
  readonly message: ChatMessage;
  readonly origin: string;
}

type PendingTurnRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAtMs: number;
  readonly data: string;
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

function previewSnippetsFromLoadedThreads(threads: Readonly<Record<string, readonly ChatMessage[]>>): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(threads)
      .map(([conversationId, messages]) => [conversationId, conversationPreviewSnippet(messages, 60)] as const)
      .filter(([, snippet]) => snippet.length > 0),
  );
}

function readConversationPreviewSnippets(handle: DatabaseHandle): ReadonlyMap<string, string> {
  const conversations = handle.prepare("SELECT id FROM conversations ORDER BY id").all() as Array<{ id: string }>;
  const recentMessages = handle.prepare("SELECT conversation_id AS conversationId, data FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT ?");
  const snippets = new Map<string, string>();
  for (const conversation of conversations) {
    const rows = recentMessages.all(conversation.id, PREVIEW_SNIPPET_LOOKBACK_MESSAGES) as MessageRow[];
    for (const row of rows) {
      const text = messagePreviewText(messageFromRow(row));
      if (text.length > 0) {
        snippets.set(row.conversationId, previewSnippet(text, 60));
        break;
      }
    }
  }
  return snippets;
}

function withConversationPreview(conversation: ConversationSummary, snippets: ReadonlyMap<string, string>): ConversationSummary {
  const snippet = snippets.get(conversation.id);
  const normalized = normalizeConversationActivityTimestamp(conversation);
  return snippet === undefined || snippet === normalized.snippet ? normalized : { ...normalized, snippet };
}

function normalizeConversationActivityTimestamp(conversation: ConversationSummary): ConversationSummary {
  return {
    ...conversation,
    updatedAtMs: normalizeConversationUpdatedAtMs(conversation.time, conversation.updatedAtMs),
  };
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
  const snippets = includeThreadIds ? readConversationPreviewSnippets(handle) : previewSnippetsFromLoadedThreads(threads);
  const conversationsForProject = (projectId: string | null): ConversationSummary[] => (convsByProject.get(projectId) ?? []).map((conversation) => withConversationPreview(conversation, snippets));
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
    state.chats.forEach((conversation, index) => insConv.run(conversation.id, null, index, JSON.stringify(normalizeConversationActivityTimestamp(conversation))));
    state.projects.forEach((project, projectIndex) => {
      const { conversations, ...meta } = project;
      insProject.run(project.id, projectIndex, JSON.stringify(meta));
      conversations.forEach((conversation, index) => insConv.run(conversation.id, project.id, index, JSON.stringify(normalizeConversationActivityTimestamp(conversation))));
    });
    for (const [conversationId, messages] of Object.entries(state.threads)) {
      messages.forEach((message, index) => insMsg.run(message.id, conversationId, index, JSON.stringify(message)));
    }
    for (const [conversationId, draft] of Object.entries(state.composerDrafts)) {
      insDraft.run(conversationId, JSON.stringify(draft));
    }
    insKv.run("selectedId", JSON.stringify(state.selectedId));
    insKv.run("settings", JSON.stringify(state.settings));
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
    return;
  }
  const position = (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM messages WHERE conversation_id = ?").get(conversationId) as { next: number }).next;
  handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)").run(message.id, conversationId, position, JSON.stringify(message));
}

function replaceConversationThreadInTransaction(handle: DatabaseHandle, conversationId: string, messages: readonly ChatMessage[]): void {
  ensureConversationExists(handle, conversationId);
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
  handle.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  const insMsg = handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)");
  messages.forEach((message, index) => insMsg.run(message.id, conversationId, index, JSON.stringify(message)));
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
          break;
        case "upsertMessages":
          for (const message of mutation.messages) {
            upsertMessageInTransaction(handle, mutation.conversationId, message);
          }
          break;
        case "replaceConversationThread":
          replaceConversationThreadInTransaction(handle, mutation.conversationId, mutation.messages);
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

/** Upsert one message row (the streaming hot path). New messages append at the
 *  end of their conversation; existing ones update in place. */
export function upsertMessage(conversationId: string, message: ChatMessage): void {
  const handle = database();
  transaction(() => {
    upsertMessageInTransaction(handle, conversationId, message);
    bumpWorkspaceRevisionInTransaction(handle);
  });
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
    .prepare("SELECT id, conversation_id AS conversationId, created_at_ms AS createdAtMs, data FROM pending_turns WHERE conversation_id = ? AND state = 'queued' ORDER BY position")
    .all(conversationId) as PendingTurnRow[];
  return {
    conversationId,
    paused: pendingQueuePaused(handle, conversationId),
    messages: rows.map((row) => pendingTurnFromRow(row).message),
  };
}

export function enqueuePendingTurn(record: PendingTurnRecord): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, record.conversationId);
    const data: PendingTurnStoredData = { message: record.message, origin: record.origin };
    handle
      .prepare("INSERT INTO pending_turns(id, conversation_id, position, created_at_ms, state, run_id, data) VALUES(?, ?, ?, ?, 'queued', NULL, ?)")
      .run(record.id, record.conversationId, nextPendingTurnPosition(handle, record.conversationId), record.createdAtMs, JSON.stringify(data));
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return readPendingTurnQueue(record.conversationId);
}

export function removePendingTurn(conversationId: string, messageId: string): PendingTurnQueueSnapshot {
  const handle = database();
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    handle.prepare("DELETE FROM pending_turns WHERE conversation_id = ? AND id = ? AND state = 'queued'").run(conversationId, messageId);
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
  const handle = database();
  let claimed: PendingTurnRecord | null = null;
  transaction(() => {
    ensureConversationExists(handle, conversationId);
    if (pendingQueuePaused(handle, conversationId)) {
      return;
    }
    const row = handle
      .prepare("SELECT id, conversation_id AS conversationId, created_at_ms AS createdAtMs, data FROM pending_turns WHERE conversation_id = ? AND state = 'queued' ORDER BY position LIMIT 1")
      .get(conversationId) as PendingTurnRow | undefined;
    if (!row) {
      return;
    }
    const result = handle.prepare("UPDATE pending_turns SET state = 'dispatching', run_id = ? WHERE id = ? AND state = 'queued'").run(runId, row.id);
    if (result.changes === 1) {
      claimed = pendingTurnFromRow(row);
      bumpWorkspaceRevisionInTransaction(handle);
    }
  });
  return claimed;
}

export function deletePendingTurn(id: string): void {
  const handle = database();
  transaction(() => {
    handle.prepare("DELETE FROM pending_turns WHERE id = ?").run(id);
    bumpWorkspaceRevisionInTransaction(handle);
  });
}

export function releasePendingTurn(id: string, options: { readonly pause: boolean }): PendingTurnRecord | null {
  const handle = database();
  let released: PendingTurnRecord | null = null;
  transaction(() => {
    const row = handle.prepare("SELECT id, conversation_id AS conversationId, created_at_ms AS createdAtMs, data FROM pending_turns WHERE id = ?").get(id) as PendingTurnRow | undefined;
    if (!row) {
      return;
    }
    handle.prepare("UPDATE pending_turns SET state = 'queued', run_id = NULL WHERE id = ?").run(id);
    if (options.pause) {
      setPendingTurnQueuePausedInTransaction(handle, row.conversationId, true);
    }
    released = pendingTurnFromRow(row);
    bumpWorkspaceRevisionInTransaction(handle);
  });
  return released;
}

export function resetDispatchingPendingTurns(): void {
  const handle = database();
  transaction(() => {
    const rows = handle.prepare("SELECT DISTINCT conversation_id AS conversationId FROM pending_turns WHERE state = 'dispatching'").all() as Array<{ conversationId: string }>;
    const result = handle.prepare("UPDATE pending_turns SET state = 'queued', run_id = NULL WHERE state = 'dispatching'").run();
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

export function closeWorkspaceDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
