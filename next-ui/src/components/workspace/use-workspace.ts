import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentBlock, type AgentId, type ChatMessage, type ConversationStatus, type ConversationSummary, type Project } from "../agent";
import { runConversation } from "./run-agent";
import { buildInitialThreads, initialChats, initialProjects, nowLabel, starterThread, truncate } from "./sample-data";

let idSeq = 1000;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

const STORAGE_KEY = "rlab-workspace-v1";

interface PersistedState {
  readonly chats: ConversationSummary[];
  readonly projects: Project[];
  readonly selectedId: string;
}

function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / serialization issues
  }
}

export interface Workspace {
  readonly chats: readonly ConversationSummary[];
  readonly projects: readonly Project[];
  readonly threads: Record<string, ChatMessage[]>;
  readonly selectedId: string;
  readonly select: (id: string) => void;
  readonly newChat: (agent: AgentId) => string;
  readonly rename: (id: string, title: string) => void;
  readonly remove: (id: string) => void;
  readonly sendMessage: (id: string, text: string) => void;
  readonly find: (id: string) => ConversationSummary | null;
  readonly cwdOf: (id: string) => string | undefined;
}

/** Stateful workspace: conversations (chats + project groups), per-conversation
 * threads, and the operations that mutate them (select / new / rename / delete /
 * send). Sending simulates a brief agent reply so statuses move running→done. */
export function useWorkspace(): Workspace {
  const persisted = loadPersisted();
  const [chats, setChats] = useState<ConversationSummary[]>(() => persisted?.chats ?? [...initialChats]);
  const [projects, setProjects] = useState<Project[]>(() => persisted?.projects ?? initialProjects.map((p) => ({ ...p, conversations: [...p.conversations] })));
  // Threads always re-seed from sample data; only conversation metadata is
  // persisted (threads carry non-serializable bits and ephemeral run output).
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>(() => buildInitialThreads());
  const [selectedId, setSelectedId] = useState<string>(() => persisted?.selectedId ?? "chat-2");
  const runs = useRef(new Map<string, AbortController>());

  useEffect(() => {
    savePersisted({ chats, projects, selectedId });
  }, [chats, projects, selectedId]);

  const find = useCallback(
    (id: string): ConversationSummary | null =>
      [...chats, ...projects.flatMap((p) => p.conversations)].find((c) => c.id === id) ?? null,
    [chats, projects],
  );

  const cwdOf = useCallback(
    (id: string): string | undefined => projects.find((p) => p.conversations.some((c) => c.id === id))?.path,
    [projects],
  );

  const patchConv = useCallback((id: string, patch: Partial<ConversationSummary>) => {
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setProjects((ps) => ps.map((p) => ({ ...p, conversations: p.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) })));
  }, []);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      patchConv(id, { unread: false });
    },
    [patchConv],
  );

  const newChat = useCallback((agent: AgentId): string => {
    const id = nextId("chat");
    const conv: ConversationSummary = { id, title: "New chat", snippet: "New conversation", time: nowLabel(), status: "idle", agent };
    setChats((cs) => [conv, ...cs]);
    setThreads((t) => ({ ...t, [id]: starterThread() }));
    setSelectedId(id);
    return id;
  }, []);

  const rename = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed) {
        patchConv(id, { title: trimmed });
      }
    },
    [patchConv],
  );

  const remove = useCallback((id: string) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    setProjects((ps) => ps.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.id !== id) })));
    setThreads((t) => {
      const next = { ...t };
      delete next[id];
      return next;
    });
    setSelectedId((cur) => (cur === id ? "" : cur));
  }, []);

  const sendMessage = useCallback(
    (id: string, text: string) => {
      const conv = find(id);
      const agent: AgentId = conv?.agent ?? "claude-code";
      const isDefaultTitle = !conv || conv.title === "New chat";
      const userMsg: ChatMessage = { id: nextId("u"), role: "user", text, time: nowLabel() };

      setThreads((t) => ({ ...t, [id]: [...(t[id] ?? []), userMsg] }));
      const runningPatch: Partial<ConversationSummary> = {
        status: "running" as ConversationStatus,
        snippet: truncate(text, 60),
        time: nowLabel(),
        unread: false,
      };
      patchConv(id, isDefaultTitle ? { ...runningPatch, title: truncate(text, 40) } : runningPatch);

      // Real run: stream the agent CLI's output into a live agent message.
      const aId = nextId("a");
      const agentTime = nowLabel();
      const applyBlocks = (blocks: AgentBlock[]) => {
        setThreads((t) => {
          const arr = t[id] ?? [];
          const message: ChatMessage = { id: aId, role: "agent", time: agentTime, blocks };
          return { ...t, [id]: arr.some((m) => m.id === aId) ? arr.map((m) => (m.id === aId ? message : m)) : [...arr, message] };
        });
      };

      runs.current.get(id)?.abort();
      const controller = new AbortController();
      runs.current.set(id, controller);

      runConversation({ agent, prompt: text, cwd: cwdOf(id), signal: controller.signal, onBlocks: applyBlocks })
        .then((result) => patchConv(id, { status: result.status, snippet: result.snippet }))
        .catch(() => patchConv(id, { status: "error", snippet: "Run failed" }))
        .finally(() => {
          if (runs.current.get(id) === controller) {
            runs.current.delete(id);
          }
        });
    },
    [find, patchConv, cwdOf],
  );

  return { chats, projects, threads, selectedId, select, newChat, rename, remove, sendMessage, find, cwdOf };
}
