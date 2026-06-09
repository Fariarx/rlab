import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import type { AgentBlock, ChatMessage, ComposerDraft, ConversationSummary, Project } from "./src/components/agent/types";
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, position);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, position);
CREATE TABLE IF NOT EXISTS composer_drafts (
  conversation_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Open (or create) the workspace database in WAL mode. Idempotent. */
export function initWorkspaceDb(file: string): void {
  if (db) {
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  // WAL: concurrent readers + a single writer, no torn writes — this also kills
  // the "Storage state is locked" race the old lock-file approach hit.
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA synchronous = NORMAL");
  handle.exec(SCHEMA);
  db = handle;
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
    : handle.prepare("SELECT conversation_id AS conversationId, data FROM messages ORDER BY conversation_id, position").all()) as Array<{ conversationId: string; data: string }>;
  const draftRows = handle.prepare("SELECT conversation_id AS conversationId, data FROM composer_drafts").all() as Array<{ conversationId: string; data: string }>;
  const kvRows = handle.prepare("SELECT key, value FROM kv").all() as Array<{ key: string; value: string }>;

  const convsByProject = new Map<string | null, ConversationSummary[]>();
  for (const row of convRows) {
    const list = convsByProject.get(row.projectId) ?? [];
    list.push(JSON.parse(row.data) as ConversationSummary);
    convsByProject.set(row.projectId, list);
  }
  const projects: Project[] = projectRows.map((row) => ({
    ...(JSON.parse(row.data) as Omit<Project, "conversations">),
    conversations: convsByProject.get(row.id) ?? [],
  }));
  const threads: Record<string, ChatMessage[]> = {};
  for (const row of msgRows) {
    (threads[row.conversationId] ??= []).push(JSON.parse(row.data) as ChatMessage);
  }
  const composerDrafts: Record<string, ComposerDraft> = {};
  for (const row of draftRows) {
    composerDrafts[row.conversationId] = JSON.parse(row.data) as ComposerDraft;
  }
  const kv = new Map(kvRows.map((row) => [row.key, row.value] as const));
  const selectedId = kv.has("selectedId") ? (JSON.parse(kv.get("selectedId") as string) as string) : "";
  const settings = JSON.parse(kv.get("settings") ?? "null") as WorkspaceState["settings"];
  return { chats: convsByProject.get(null) ?? [], projects, threads, composerDrafts, selectedId, settings };
}

/** Replace the entire persisted tree in one transaction. For full-state writes
 *  (UI PUT, seed, reconcile) — infrequent, so a full rewrite is fine; the hot
 *  streaming path uses the per-row upserts below instead. */
export function writeWorkspaceStateToDb(state: WorkspaceState): void {
  const handle = database();
  transaction(() => {
    handle.exec("DELETE FROM projects; DELETE FROM conversations; DELETE FROM messages; DELETE FROM composer_drafts; DELETE FROM kv;");
    const insProject = handle.prepare("INSERT INTO projects(id, position, data) VALUES(?, ?, ?)");
    const insConv = handle.prepare("INSERT INTO conversations(id, project_id, position, data) VALUES(?, ?, ?, ?)");
    const insMsg = handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)");
    const insDraft = handle.prepare("INSERT INTO composer_drafts(conversation_id, data) VALUES(?, ?)");
    const insKv = handle.prepare("INSERT INTO kv(key, value) VALUES(?, ?)");
    state.chats.forEach((conversation, index) => insConv.run(conversation.id, null, index, JSON.stringify(conversation)));
    state.projects.forEach((project, projectIndex) => {
      const { conversations, ...meta } = project;
      insProject.run(project.id, projectIndex, JSON.stringify(meta));
      conversations.forEach((conversation, index) => insConv.run(conversation.id, project.id, index, JSON.stringify(conversation)));
    });
    for (const [conversationId, messages] of Object.entries(state.threads)) {
      messages.forEach((message, index) => insMsg.run(message.id, conversationId, index, JSON.stringify(message)));
    }
    for (const [conversationId, draft] of Object.entries(state.composerDrafts)) {
      insDraft.run(conversationId, JSON.stringify(draft));
    }
    insKv.run("selectedId", JSON.stringify(state.selectedId));
    insKv.run("settings", JSON.stringify(state.settings));
  });
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
  const existing = handle.prepare("SELECT position FROM messages WHERE id = ?").get(message.id) as { position: number } | undefined;
  const position = existing
    ? existing.position
    : (handle.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM messages WHERE conversation_id = ?").get(conversationId) as { next: number }).next;
  handle
    .prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, data = excluded.data")
    .run(message.id, conversationId, position, JSON.stringify(message));
}

/** Read a single conversation summary (hot path: patch status without loading
 *  the whole workspace). */
export function readConversation(conversationId: string): ConversationSummary | undefined {
  const row = database().prepare("SELECT data FROM conversations WHERE id = ?").get(conversationId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ConversationSummary) : undefined;
}

/** Update a single conversation's summary in place (keeps its position/project). */
export function updateConversationData(conversation: ConversationSummary): void {
  database().prepare("UPDATE conversations SET data = ? WHERE id = ?").run(JSON.stringify(conversation), conversation.id);
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

/** Write the shell (projects/conversations/composer_drafts/kv) in full, replace
 *  messages only for the threads PRESENT in `state.threads`, and PRESERVE threads
 *  the caller didn't include (the client only holds lazily-loaded ones). Messages
 *  of conversations that no longer exist in the shell are dropped. Used by the
 *  client `PUT /api/workspace` so a partial client never clobbers unopened chats. */
export function writeWorkspaceShellPreservingThreads(state: WorkspaceState): void {
  const handle = database();
  transaction(() => {
    handle.exec("DELETE FROM projects; DELETE FROM conversations; DELETE FROM composer_drafts; DELETE FROM kv;");
    const insProject = handle.prepare("INSERT INTO projects(id, position, data) VALUES(?, ?, ?)");
    const insConv = handle.prepare("INSERT INTO conversations(id, project_id, position, data) VALUES(?, ?, ?, ?)");
    const insDraft = handle.prepare("INSERT INTO composer_drafts(conversation_id, data) VALUES(?, ?)");
    const insKv = handle.prepare("INSERT INTO kv(key, value) VALUES(?, ?)");
    state.chats.forEach((conversation, index) => insConv.run(conversation.id, null, index, JSON.stringify(conversation)));
    state.projects.forEach((project, projectIndex) => {
      const { conversations, ...meta } = project;
      insProject.run(project.id, projectIndex, JSON.stringify(meta));
      conversations.forEach((conversation, index) => insConv.run(conversation.id, project.id, index, JSON.stringify(conversation)));
    });
    for (const [conversationId, draft] of Object.entries(state.composerDrafts)) {
      insDraft.run(conversationId, JSON.stringify(draft));
    }
    insKv.run("selectedId", JSON.stringify(state.selectedId));
    insKv.run("settings", JSON.stringify(state.settings));
    const delMsgs = handle.prepare("DELETE FROM messages WHERE conversation_id = ?");
    const insMsg = handle.prepare("INSERT INTO messages(id, conversation_id, position, data) VALUES(?, ?, ?, ?)");
    for (const [conversationId, messages] of Object.entries(state.threads)) {
      delMsgs.run(conversationId);
      messages.forEach((message, index) => insMsg.run(message.id, conversationId, index, JSON.stringify(message)));
    }
    // Drop messages whose conversation was deleted (not in the new shell), while
    // leaving lazily-unloaded threads (their conversation IS still in the shell).
    handle.exec("DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations)");
  });
}

export function closeWorkspaceDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
