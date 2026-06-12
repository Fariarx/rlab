import { makeAutoObservable, reaction, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { accessModeForAgentProfile, compactCommandForAgent, normalizeAgentProfile, type AgentBlock, type AgentId, type AgentProfile, type ApprovalDecision, type ChatMessage, type CompactionSettings, type ComposerDraft, type ConversationStatus, type ConversationSummary, type ConversationView, type Project, type ReviewCommentEntry } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { attachRunUpdates, cancelRun, loadActiveRuns, runConversation, type ActiveRunSnapshot, type ActiveRunUpdate, type RunConversationResult } from "./run-agent";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, type Locale, mergeAppSettings } from "./app-settings";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./workspace-state";

const WORKSPACE_LOAD_RETRY_MS = 15_000;
const WORKSPACE_SAVE_DEBOUNCE_MS = 250;
const WORKSPACE_SAVE_RETRY_MS = 2_000;
const BACKGROUND_ATTACH_SILENCE_RECONCILE_MS = 20_000;

let idSeq = 1000;
const nextId = (prefix: string) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${++idSeq}-${Date.now().toString(36)}`;
};

function generatedIdSequence(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = /^(?:chat|u|a|run)-(\d+)/.exec(value);
  return match ? Number(match[1]) : 0;
}

function syncGeneratedIdSequence(state: WorkspaceState): void {
  const conversations = workspaceConversations(state);
  const messageIds = Object.values(state.threads).flatMap((messages) => messages.map((message) => message.id));
  const activeRunIds = conversations.map((conversation) => conversation.activeRunId);
  const max = Math.max(0, ...conversations.map((conversation) => generatedIdSequence(conversation.id)), ...messageIds.map(generatedIdSequence), ...activeRunIds.map(generatedIdSequence));
  idSeq = Math.max(idSeq, max);
}

interface RunHandle {
  readonly controller: AbortController;
  readonly runId: string;
  serverOwned: boolean;
  canceled: boolean;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly path: string;
  readonly profile: AgentProfile;
}

export interface CreatedProject {
  readonly projectId: string;
  readonly conversationId: string;
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as unknown;
  return typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" && payload.error.trim().length > 0
    ? payload.error.trim()
    : fallback;
}

async function loadWorkspaceState(): Promise<WorkspaceState> {
  const response = await fetch("/api/workspace", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace load failed (${response.status})`));
  }
  return (await response.json()) as WorkspaceState;
}

type ProjectMeta = Omit<Project, "conversations">;

type WorkspaceMutation =
  | { readonly type: "setSelectedConversation"; readonly conversationId: string }
  | { readonly type: "setSettings"; readonly settings: AppSettings }
  | { readonly type: "upsertProject"; readonly project: ProjectMeta; readonly insertAtFront?: boolean }
  | { readonly type: "upsertConversation"; readonly conversation: ConversationSummary; readonly projectId: string | null; readonly insertAtFront?: boolean }
  | { readonly type: "updateConversation"; readonly conversation: ConversationSummary }
  | { readonly type: "deleteConversation"; readonly conversationId: string }
  | { readonly type: "setComposerDraft"; readonly conversationId: string; readonly draft: ComposerDraft }
  | { readonly type: "deleteComposerDraft"; readonly conversationId: string }
  | { readonly type: "upsertMessage"; readonly conversationId: string; readonly message: ChatMessage }
  | { readonly type: "upsertMessages"; readonly conversationId: string; readonly messages: readonly ChatMessage[] }
  | { readonly type: "replaceConversationThread"; readonly conversationId: string; readonly messages: readonly ChatMessage[] };

async function saveWorkspaceMutations(mutations: readonly WorkspaceMutation[]): Promise<void> {
  if (mutations.length === 0) {
    return;
  }
  const response = await fetch("/api/workspace/mutations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mutations }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace save failed (${response.status})`));
  }
}

function findConversation(state: WorkspaceState, id: string): ConversationSummary | null {
  return [...state.chats, ...state.projects.flatMap((p) => p.conversations)].find((c) => c.id === id) ?? null;
}

function workspaceConversations(state: WorkspaceState): ConversationSummary[] {
  return [...state.chats, ...state.projects.flatMap((project) => project.conversations)];
}

function projectMeta(project: Project): ProjectMeta {
  const { conversations: _conversations, ...meta } = project;
  return meta;
}

function projectIdForConversation(state: WorkspaceState, conversationId: string): string | null {
  return state.projects.find((project) => project.conversations.some((conversation) => conversation.id === conversationId))?.id ?? null;
}

/** The attachment-block portion of a sent user message (inline text-file blocks
 *  and path-based file links), so editing+resending keeps the attachments. */
function extractAttachmentBlocks(text: string): string {
  const blocks: string[] = [];
  for (const match of text.matchAll(/<attachment\s+name="[^"]*"[^>]*>[\s\S]*?<\/attachment>/g)) {
    blocks.push(match[0]);
  }
  for (const match of text.matchAll(/!?\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? "";
    if (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target)) {
      blocks.push(match[0]);
    }
  }
  return blocks.join("\n\n");
}

function serializableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function conversationProfile(conversation: ConversationSummary | null | undefined): AgentProfile {
  return normalizeAgentProfile(conversation?.profile, conversation?.agent ?? "claude-code");
}

/** A lean transcript line for one message: the user's text, or the agent's
 *  answer (text/code blocks only — reasoning and tool noise are omitted). */
function messageTranscriptText(message: ChatMessage): string {
  if (message.role === "user") {
    return (message.text ?? "").trim();
  }
  return (message.blocks ?? [])
    .map((block) => (block.kind === "text" ? block.text : block.kind === "code" ? block.code : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Builds the agent prompt from the conversation so far. Each agent run is a
 *  fresh, stateless invocation (no session/resume), so prior turns must be
 *  replayed in the prompt or the agent loses the thread. First message in a
 *  conversation → just the text. */
export function buildAgentPrompt(priorMessages: readonly ChatMessage[], currentText: string): string {
  const turns = priorMessages
    .map((message) => {
      const content = messageTranscriptText(message);
      return content ? `${message.role === "user" ? "User" : "Assistant"}: ${content}` : null;
    })
    .filter((line): line is string => line !== null);
  if (turns.length === 0) {
    return currentText;
  }
  return `This is a continuing conversation; here are the earlier turns for context:\n\n${turns.join("\n\n")}\n\n---\n\nUser: ${currentText}`;
}

/** The project's base working directory (ignores any worktree override). */
function conversationBasePath(state: WorkspaceState, id: string): string | undefined {
  return state.projects.find((p) => p.conversations.some((c) => c.id === id))?.path;
}

/** The directory the agent/Git view actually operate in: an isolated worktree
 *  when one is attached to the conversation, otherwise the project base path. */
function conversationCwd(state: WorkspaceState, id: string): string | undefined {
  return findConversation(state, id)?.worktreePath ?? conversationBasePath(state, id);
}

function patchConversation(state: WorkspaceState, id: string, patch: Partial<ConversationSummary>): WorkspaceState {
  return {
    ...state,
    chats: state.chats.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    projects: state.projects.map((p) => ({
      ...p,
      conversations: p.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  };
}

function conversationSessionId(conversation: ConversationSummary | null | undefined, agent: AgentId): string | undefined {
  return conversation?.agentSessions?.[agent] ?? (conversation?.sessionAgent === agent ? conversation.sessionId : undefined);
}

function patchConversationAgentSession(state: WorkspaceState, id: string, agent: AgentId, sessionId: string): WorkspaceState {
  const conversation = findConversation(state, id);
  const agentSessions: Partial<Record<AgentId, string>> = { ...(conversation?.agentSessions ?? {}), [agent]: sessionId };
  return patchConversation(state, id, { agentSessions, sessionId, sessionAgent: agent });
}

function patchApprovalDecision(state: WorkspaceState, conversationId: string, approvalId: string, decision: ApprovalDecision): WorkspaceState {
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: (state.threads[conversationId] ?? []).map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => (block.kind === "approval" && block.id === approvalId ? { ...block, decision } : block)),
      })),
    },
  };
}

function patchOptionSelection(state: WorkspaceState, conversationId: string, optionBlockId: string, selectedLabels: readonly string[]): WorkspaceState {
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: (state.threads[conversationId] ?? []).map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => (block.kind === "options" && block.id === optionBlockId ? { ...block, selected: [...selectedLabels] } : block)),
      })),
    },
  };
}

function mergeInputBlockState(blocks: readonly AgentBlock[], previousBlocks: readonly AgentBlock[] | undefined): AgentBlock[] {
  return blocks.map((block) => {
    if (block.kind === "approval" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "approval" && item.id === block.id);
      return previous?.kind === "approval" && previous.decision ? { ...block, decision: previous.decision } : block;
    }
    if (block.kind === "options" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "options" && item.id === block.id);
      return previous?.kind === "options" && previous.selected ? { ...block, selected: [...previous.selected] } : block;
    }
    return block;
  });
}

function blocksNeedInput(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "approval") {
      return !block.decision;
    }
    if (block.kind === "options") {
      return !block.selected || block.selected.length === 0;
    }
    return false;
  });
}

function blocksHaveLiveOutput(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case "reasoning":
        return block.active === true;
      case "text":
        return block.streaming === true;
      case "tool":
      case "command":
      case "search":
        return block.state === "running";
      case "plan":
        return block.steps.some((step) => step.state === "running");
      default:
        return false;
    }
  });
}

/** Clears a block's "live" flags so the UI stops animating it. Used when a run
 *  is stopped or errors mid-stream — otherwise reasoning/tool blocks keep their
 *  "working" animation even though the agent is no longer running. */
function settleLiveBlock(block: AgentBlock): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state: "error" } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running") ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state: "error" } : step)) } : block;
    default:
      return block;
  }
}

function finishLiveBlock(block: AgentBlock, state: "ok" | "error"): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running") ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state } : step)) } : block;
    default:
      return block;
  }
}

function settleThreadLiveBlocks(state: WorkspaceState, id: string): WorkspaceState {
  const messages = state.threads[id];
  if (!messages) {
    return state;
  }
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "agent" || !message.blocks) {
      return message;
    }
    const blocks = message.blocks.map(settleLiveBlock);
    if (blocks.some((block, index) => block !== message.blocks![index])) {
      changed = true;
      return { ...message, blocks };
    }
    return message;
  });
  return changed ? { ...state, threads: { ...state.threads, [id]: next } } : state;
}

function finishThreadLiveBlocks(state: WorkspaceState, id: string, runState: "ok" | "error"): WorkspaceState {
  const messages = state.threads[id];
  if (!messages) {
    return state;
  }
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "agent" || !message.blocks) {
      return message;
    }
    const blocks = message.blocks.map((block) => finishLiveBlock(block, runState));
    if (blocks.some((block, index) => block !== message.blocks![index])) {
      changed = true;
      return { ...message, blocks };
    }
    return message;
  });
  return changed ? { ...state, threads: { ...state.threads, [id]: next } } : state;
}

function finishBlocks(blocks: readonly AgentBlock[], runState: "ok" | "error"): AgentBlock[] {
  return blocks.map((block) => finishLiveBlock(block, runState));
}

function cloneMessageForFork(message: ChatMessage): ChatMessage {
  const idPrefix = message.role === "user" ? "u" : "a";
  return {
    ...message,
    id: nextId(idPrefix),
    profile: message.profile ? normalizeAgentProfile(message.profile, message.profile.agent) : undefined,
    blocks: message.blocks?.map((block) => finishLiveBlock(JSON.parse(JSON.stringify(block)) as AgentBlock, "ok")),
  };
}

function blocksHaveStatus(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => block.kind === "status");
}

function snippetFromBlocks(blocks: readonly AgentBlock[] | undefined, locale: Locale): string {
  const textBlock = [...(blocks ?? [])].reverse().find((block) => block.kind === "text" && block.text.trim().length > 0);
  const snippetSource = textBlock?.kind === "text" ? textBlock.text : translate(locale, "runDoneSnippet");
  return truncate(snippetSource.replace(/\s+/g, " "), 60);
}

type SettledRunConversationResult = RunConversationResult & { readonly status: "done" | "error" | "waiting" };

function isSettledRunConversationResult(result: RunConversationResult): result is SettledRunConversationResult {
  return result.status !== "detached";
}

function finalRunPatch(
  current: WorkspaceState,
  conversationId: string,
  agentMessageId: string,
  result: SettledRunConversationResult,
): Partial<ConversationSummary> {
  const locale = current.settings.general.locale;
  const agentBlocks = current.threads[conversationId]?.find((message) => message.id === agentMessageId)?.blocks;
  const inputResolved = agentBlocks !== undefined && !blocksNeedInput(agentBlocks);
  const resolvedStatus = result.status === "waiting" && inputResolved ? "done" : result.status;
  const resolvedSnippet = result.status === "waiting" && resolvedStatus === "done" ? snippetFromBlocks(agentBlocks, locale) : result.snippet;
  return {
    activeRunId: undefined,
    status: resolvedStatus,
    snippet: resolvedSnippet,
    ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function patchAgentMessageUsage(
  state: WorkspaceState,
  conversationId: string,
  agentMessageId: string,
  result: Pick<RunConversationResult, "costUsd" | "usage">,
): WorkspaceState {
  if (result.costUsd === undefined && result.usage === undefined) {
    return state;
  }
  const messages = state.threads[conversationId];
  if (!messages?.some((message) => message.id === agentMessageId)) {
    return state;
  }
  return {
    ...state,
    threads: {
      ...state.threads,
      [conversationId]: messages.map((message) =>
        message.id === agentMessageId
          ? {
              ...message,
              ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
              ...(result.usage === undefined ? {} : { usage: result.usage }),
            }
          : message,
      ),
    },
  };
}

function upsertAgentMessageForUserTurn(messages: readonly ChatMessage[], userMessageId: string, message: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  const withoutCurrent = messages.filter((item) => item.id !== message.id);
  const userIndex = withoutCurrent.findIndex((item) => item.id === userMessageId && item.role === "user");
  if (userIndex < 0) {
    return existingIndex >= 0 ? messages.map((item) => (item.id === message.id ? message : item)) : [...messages, message];
  }
  const nextUserIndex = withoutCurrent.findIndex((item, index) => index > userIndex && item.role === "user");
  const staleReplyEnd = nextUserIndex < 0 ? withoutCurrent.length : nextUserIndex;
  const before = withoutCurrent.slice(0, userIndex + 1);
  const after = withoutCurrent.slice(staleReplyEnd);
  return [...before, message, ...after];
}

function isLiveRunStatus(status: ConversationStatus): boolean {
  return status === "running" || status === "waiting";
}

function patchActiveRunUpdate(state: WorkspaceState, update: ActiveRunUpdate): WorkspaceState {
  const messages = state.threads[update.conversationId] ?? [];
  const previousMessage = messages.find((message) => message.id === update.agentMessageId);
  const previousBlocks = previousMessage?.blocks;
  const profile = previousMessage?.profile ?? conversationProfile(findConversation(state, update.conversationId));
  const mergedBlocks = mergeInputBlockState(update.blocks, previousBlocks);
  const blocks = update.done || !isLiveRunStatus(update.status) ? finishBlocks(mergedBlocks, update.status === "error" || update.status === "idle" ? "error" : "ok") : mergedBlocks;
  const message: ChatMessage = {
    id: update.agentMessageId,
    role: "agent",
    time: update.time,
    ...(update.startedAtMs === undefined ? {} : { startedAtMs: update.startedAtMs }),
    profile,
    blocks,
    ...(update.costUsd === undefined ? {} : { costUsd: update.costUsd }),
    ...(update.usage === undefined ? {} : { usage: update.usage }),
  };
  const threads = {
    ...state.threads,
    [update.conversationId]: upsertAgentMessageForUserTurn(messages, update.userMessageId, message),
  };
  return patchConversation({ ...state, threads }, update.conversationId, {
    activeRunId: update.done || !isLiveRunStatus(update.status) ? undefined : update.runId,
    status: update.status,
    snippet: update.snippet,
    time: update.time,
    ...(update.costUsd === undefined ? {} : { costUsd: update.costUsd }),
    ...(update.usage === undefined ? {} : { usage: update.usage }),
  });
}

function projectIdFromName(name: string): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Project name must contain letters or numbers.");
  }
  return id;
}

function isDefaultConversationTitle(title: string | undefined): boolean {
  return title === undefined || title === translate("en", "newChat") || title === translate("ru", "newChat");
}

export interface Workspace {
  readonly chats: readonly ConversationSummary[];
  readonly projects: readonly Project[];
  readonly threads: Record<string, ChatMessage[]>;
  readonly composerDrafts: Record<string, ComposerDraft>;
  readonly selectedId: string;
  readonly settings: AppSettings;
  readonly select: (id: string) => void;
  readonly newChat: (profile: AgentProfile) => string;
  readonly createProject: (input: CreateProjectInput) => CreatedProject;
  readonly newProjectChat: (projectId: string, profile: AgentProfile) => string;
  readonly setConversationProfile: (id: string, profile: AgentProfile) => void;
  readonly rename: (id: string, title: string) => void;
  readonly togglePin: (id: string) => void;
  readonly archive: (id: string) => void;
  readonly remove: (id: string) => string;
  readonly sendMessage: (id: string, text: string) => void;
  readonly pendingMessageCount: (id: string) => number;
  readonly sendQueuedMessageNow: (id: string) => boolean;
  readonly setCompaction: (id: string, patch: Partial<CompactionSettings>) => void;
  readonly setConversationView: (id: string, view: ConversationView) => void;
  readonly compactConversation: (id: string) => boolean;
  readonly addReviewComments: (id: string, comments: readonly ReviewCommentEntry[]) => void;
  readonly stopRun: (id: string) => void;
  readonly retryMessage: (id: string, messageId: string) => void;
  readonly forkConversationFromMessage: (id: string, messageId: string) => string | null;
  readonly editAndResendMessage: (id: string, messageId: string, text: string) => void;
  readonly decideApproval: (id: string, approvalId: string, decision: ApprovalDecision) => void;
  readonly selectOptions: (id: string, optionBlockId: string, selectedLabels: readonly string[]) => void;
  readonly updateComposerDraft: (id: string, draft: ComposerDraft) => void;
  readonly updateSettings: (patch: AppSettingsPatch) => void;
  readonly reloadWorkspace: () => void;
  readonly loadThread: (id: string) => Promise<void>;
  readonly loadAllThreads: () => Promise<void>;
  readonly find: (id: string) => ConversationSummary | null;
  readonly cwdOf: (id: string) => string | undefined;
  readonly basePathOf: (id: string) => string | undefined;
  readonly setWorktree: (id: string, worktreePath: string | undefined) => void;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly loadError: string | null;
}

class WorkspaceStore implements Workspace {
  // Pre-load placeholder (replaced by the server's state). Demo data only in dev
  // so a production build never flashes sample conversations before hydration.
  state: WorkspaceState = import.meta.env.DEV ? buildInitialWorkspaceState() : buildEmptyWorkspaceState();

  loadError: string | null = null;

  loaded = false;

  loading = true;

  private hydrated = false;

  private loadSeq = 0;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private saveRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingMutations: WorkspaceMutation[] = [];

  private pendingSaveUrgent = false;

  private saveInFlight = false;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private loadRetryTimer: ReturnType<typeof setInterval> | null = null;

  private skipNextSave = false;

  private readonly runs = new Map<string, RunHandle>();
  // User messages sent while a run is in flight wait here (per conversation) and
  // are dispatched one-by-one as each run settles, so a new message never
  // interrupts the agent mid-turn. Kept in memory; the queued user messages are
  // already appended to the (persisted) thread for visibility.
  private readonly pendingMessages = new Map<string, ChatMessage[]>();

  // The GET shell ships only the selected conversation's thread; the rest load
  // lazily on open. `fullyLoadedThreadIds` tracks which threads the client fully
  // holds (a run streaming into an unloaded thread does NOT mark it loaded, so
  // opening it still fetches the full history). `threadLoads` dedupes in-flight
  // fetches and lets `loadAllThreads` await them.
  private readonly fullyLoadedThreadIds = new Set<string>();
  private readonly threadLoads = new Map<string, Promise<void>>();
  private readonly dirtyThreadVersions = new Map<string, number>();
  private nextDirtyThreadVersion = 0;

  constructor() {
    makeAutoObservable<
      WorkspaceStore,
      | "hydrated"
      | "loadSeq"
      | "runs"
      | "saveTimer"
      | "saveRetryTimer"
      | "pendingMutations"
      | "pendingSaveUrgent"
      | "saveInFlight"
      | "pollTimer"
      | "loadRetryTimer"
      | "skipNextSave"
      | "fullyLoadedThreadIds"
      | "threadLoads"
      | "dirtyThreadVersions"
      | "nextDirtyThreadVersion"
    >(
      this,
      {
        hydrated: false,
        loadSeq: false,
        runs: false,
        saveTimer: false,
        saveRetryTimer: false,
        pendingMutations: false,
        pendingSaveUrgent: false,
        saveInFlight: false,
        pollTimer: false,
        loadRetryTimer: false,
        skipNextSave: false,
        fullyLoadedThreadIds: false,
        threadLoads: false,
        dirtyThreadVersions: false,
        nextDirtyThreadVersion: false,
      },
      { autoBind: true },
    );
  }

  get chats(): readonly ConversationSummary[] {
    return this.state.chats;
  }

  get projects(): readonly Project[] {
    return this.state.projects;
  }

  get threads(): Record<string, ChatMessage[]> {
    return this.state.threads;
  }

  get composerDrafts(): Record<string, ComposerDraft> {
    return this.state.composerDrafts;
  }

  get selectedId(): string {
    return this.state.selectedId;
  }

  get settings(): AppSettings {
    return this.state.settings;
  }

  private applyServerState(state: WorkspaceState): void {
    syncGeneratedIdSequence(state);
    // The shell ships only some threads (the selected one); those it does ship
    // are fully loaded. Reset the tracking to match the freshly loaded shell.
    this.fullyLoadedThreadIds.clear();
    this.threadLoads.clear();
    this.dirtyThreadVersions.clear();
    for (const id of Object.keys(state.threads)) {
      this.fullyLoadedThreadIds.add(id);
    }
    if (this.state !== state) {
      this.skipNextSave = true;
      this.state = state;
    }
  }

  /** Lazily fetch a conversation's full message thread (the GET shell omits all
   *  but the selected one). No-op once fully held; never triggers a save. */
  loadThread(id: string): Promise<void> {
    if (!id || this.fullyLoadedThreadIds.has(id)) {
      return Promise.resolve();
    }
    const existing = this.threadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const response = await fetch(`/api/thread?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response, `Thread load failed (${response.status})`));
        }
        const { messages } = (await response.json()) as { messages: ChatMessage[] };
        runInAction(() => {
          this.fullyLoadedThreadIds.add(id);
          // Preserve any messages the client appended WHILE this fetch was in
          // flight — a freshly sent user message and its streaming agent reply
          // must never be clobbered by the loaded history (otherwise the message
          // vanishes mid-run and the agent appears not to respond).
          const fetchedIds = new Set(messages.map((message) => message.id));
          const inFlight = (this.state.threads[id] ?? []).filter((message) => !fetchedIds.has(message.id));
          this.skipNextSave = true;
          this.state = { ...this.state, threads: { ...this.state.threads, [id]: [...messages, ...inFlight] } };
        });
      } catch (error) {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      } finally {
        this.threadLoads.delete(id);
      }
    })();
    this.threadLoads.set(id, promise);
    return promise;
  }

  /** Ensure every conversation's thread is loaded — used before full-text search,
   *  which scans across all threads. */
  async loadAllThreads(): Promise<void> {
    const ids = [...this.state.chats, ...this.state.projects.flatMap((project) => project.conversations)].map((conversation) => conversation.id);
    await Promise.all(ids.map((id) => this.loadThread(id)));
  }

  mount(): void {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.hydrated && !this.loading) {
          void this.refreshBackgroundRuns();
        }
      }, 2000);
    }
    if (!this.loadRetryTimer) {
      this.loadRetryTimer = setInterval(() => {
        if (!this.loaded && this.loadError && !this.loading) {
          this.reloadWorkspace();
        }
      }, WORKSPACE_LOAD_RETRY_MS);
    }
    this.reloadWorkspace();
  }

  unmount(): void {
    this.loadSeq += 1;
    void this.flushPendingSave();
    for (const run of this.runs.values()) {
      run.controller.abort();
    }
    this.runs.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.loadRetryTimer) {
      clearInterval(this.loadRetryTimer);
      this.loadRetryTimer = null;
    }
    if (this.saveRetryTimer) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }
  }

  private startSaveTimer(): void {
    if (this.saveTimer !== null || this.saveInFlight) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushPendingSave();
    }, WORKSPACE_SAVE_DEBOUNCE_MS);
  }

  private startSaveRetryTimer(): void {
    if (this.saveRetryTimer !== null) {
      return;
    }
    this.saveRetryTimer = setTimeout(() => {
      this.saveRetryTimer = null;
      void this.flushPendingSave();
    }, WORKSPACE_SAVE_RETRY_MS);
  }

  private enqueueMutations(...mutations: WorkspaceMutation[]): void {
    if (mutations.length === 0) {
      return;
    }
    this.pendingMutations.push(...mutations);
    this.startSaveTimer();
  }

  private persistCurrentStateNow(): void {
    this.pendingSaveUrgent = true;
    void this.flushPendingSave();
  }

  private markThreadDirty(id: string): void {
    this.dirtyThreadVersions.set(id, ++this.nextDirtyThreadVersion);
  }

  private async flushPendingSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveRetryTimer !== null) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }
    if (this.saveInFlight) {
      this.pendingSaveUrgent = true;
      return;
    }
    if (this.pendingMutations.length === 0) {
      return;
    }
    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    this.pendingSaveUrgent = false;
    this.saveInFlight = true;
    let saveFailed = false;
    try {
      await saveWorkspaceMutations(mutations);
      runInAction(() => {
        if (this.loadError?.startsWith("Workspace save failed")) {
          this.loadError = null;
        }
      });
    } catch (error) {
      saveFailed = true;
      runInAction(() => {
        const message = error instanceof Error ? error.message : String(error);
        this.loadError = message.startsWith("Workspace save failed") ? message : `Workspace save failed: ${message}`;
        this.pendingMutations = [...mutations, ...this.pendingMutations];
        this.pendingSaveUrgent = false;
        this.startSaveRetryTimer();
      });
    } finally {
      runInAction(() => {
        this.saveInFlight = false;
        if (this.pendingMutations.length > 0) {
          if (this.pendingSaveUrgent) {
            void this.flushPendingSave();
          } else if (!saveFailed) {
            this.startSaveTimer();
          }
        }
      });
    }
  }

  reloadWorkspace(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.loadError = null;
    loadWorkspaceState()
      .then((loadedState) => {
        if (seq !== this.loadSeq) {
          return;
        }
        runInAction(() => {
          this.applyServerState(cloneWorkspaceState(loadedState));
          this.loadError = null;
          this.loaded = true;
          this.hydrated = true;
        });
        void this.refreshBackgroundRuns();
      })
      .catch((error) => {
        if (seq !== this.loadSeq) {
          return;
        }
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
          this.loaded = false;
        });
      })
      .finally(() => {
        if (seq === this.loadSeq) {
          runInAction(() => {
            this.loading = false;
          });
        }
      });
  }

  private hasPersistedActiveRuns(): boolean {
    return [...this.state.chats, ...this.state.projects.flatMap((project) => project.conversations)].some(
      (conversation) => Boolean(conversation.activeRunId) && !this.runs.has(conversation.id) && (conversation.status === "running" || conversation.status === "waiting"),
    );
  }

  /** Decide whether to reconcile background runs with the server, then do it.
   *
   *  Two independent triggers, because either side can be the stale one:
   *   - The persisted state shows an active run we aren't tracking — reconcile it
   *     (it may have finished server-side, so this is also how a run flips to
   *     "done" after a reload).
   *   - The server still owns a live run we aren't tracking, even though the
   *     persisted status missed it (e.g. a run left mid-stream is alive and
   *     waiting for tool approval, yet the saved status reads "error"/no
   *     activeRunId). Gating reattach purely on persisted status meant a page
   *     reload silently abandoned that live run; the server handle list is the
   *     source of truth, so we consult it to re-attach and surface the approval. */
  private async refreshBackgroundRuns(): Promise<void> {
    if (this.hasPersistedActiveRuns()) {
      void this.syncBackgroundRuns();
      return;
    }
    const seq = this.loadSeq;
    let active: ActiveRunSnapshot[];
    try {
      active = await loadActiveRuns();
    } catch (error) {
      if (seq !== this.loadSeq) {
        return;
      }
      if (this.runs.size > 0) {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      }
      return;
    }
    if (seq !== this.loadSeq) {
      return;
    }
    if (active.some((run) => !this.runs.has(run.conversationId))) {
      void this.syncBackgroundRuns();
    }
  }

  private async syncBackgroundRuns(): Promise<void> {
    const seq = this.loadSeq;
    try {
      const activeRuns = await loadActiveRuns();
      const activeRunIds = new Set(activeRuns.map((run) => run.runId));
      const loadedState = await loadWorkspaceState();
      if (seq !== this.loadSeq) {
        return;
      }
      runInAction(() => {
        this.applyServerState(this.mergeBackgroundRunState(this.state, loadedState, activeRunIds));
        this.loadError = null;
      });
      for (const run of activeRuns) {
        this.attachBackgroundRun(run);
      }
    } catch (error) {
      if (seq !== this.loadSeq) {
        return;
      }
      runInAction(() => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private mergeBackgroundRunState(current: WorkspaceState, loaded: WorkspaceState, activeRunIds: ReadonlySet<string>): WorkspaceState {
    const ids = new Set(
      workspaceConversations(current)
        .filter((conversation) => Boolean(conversation.activeRunId) && !this.runs.has(conversation.id))
        .map((conversation) => conversation.id),
    );
    if (ids.size === 0) {
      return current;
    }
    let next = current;
    let threads: Record<string, ChatMessage[]> | null = null;
    for (const id of ids) {
      const loadedConversation = findConversation(loaded, id);
      if (!loadedConversation) {
        continue;
      }
      const currentConversation = findConversation(next, id);
      if (
        currentConversation?.activeRunId &&
        !activeRunIds.has(currentConversation.activeRunId) &&
        loadedConversation.activeRunId === currentConversation.activeRunId &&
        (loadedConversation.status === "running" || loadedConversation.status === "waiting")
      ) {
        // The server no longer tracks this run and it never wrote a terminal
        // state — it was interrupted (e.g. the process was restarted mid-run).
        // Stop the dialog: settle live blocks + clear the run so the stop button
        // and spinners disappear instead of hanging forever. Safe because a
        // genuinely-live run re-asserts `running` on its next streamed event
        // (backgroundRunStatusPatch), which would re-list it in activeRunIds.
        next = patchConversation(settleThreadLiveBlocks(next, id), id, {
          activeRunId: undefined,
          status: "error",
          snippet: translate(loaded.settings.general.locale, "runInterruptedSnippet"),
        });
        continue;
      }
      if (!serializableEqual(currentConversation, loadedConversation)) {
        next = patchConversation(next, id, loadedConversation);
      }
      const loadedThread = loaded.threads[id] ?? current.threads[id] ?? [];
      const currentThread = current.threads[id] ?? [];
      if (!serializableEqual(currentThread, loadedThread)) {
        threads = threads ?? { ...current.threads };
        threads[id] = loadedThread;
      }
    }
    return threads ? { ...next, threads } : next;
  }

  private attachBackgroundRun(run: ActiveRunSnapshot): void {
    if (this.runs.has(run.conversationId)) {
      return;
    }
    const controller = new AbortController();
    const runHandle: RunHandle = { controller, runId: run.runId, serverOwned: true, canceled: false };
    this.runs.set(run.conversationId, runHandle);
    let terminalUpdateReceived = false;
    let attachErrorMessage: string | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSilenceTimer = () => {
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };
    const scheduleSilenceReconcile = () => {
      clearSilenceTimer();
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (this.runs.get(run.conversationId) !== runHandle || controller.signal.aborted || runHandle.canceled) {
          return;
        }
        void loadActiveRuns()
          .then((activeRuns) => {
            if (this.runs.get(run.conversationId) !== runHandle || controller.signal.aborted || runHandle.canceled) {
              return;
            }
            if (activeRuns.some((activeRun) => activeRun.runId === run.runId)) {
              scheduleSilenceReconcile();
              return;
            }
            this.runs.delete(run.conversationId);
            controller.abort();
            void this.syncBackgroundRuns();
          })
          .catch((error) => {
            if (this.runs.get(run.conversationId) !== runHandle || controller.signal.aborted || runHandle.canceled) {
              return;
            }
            runInAction(() => {
              this.loadError = error instanceof Error ? error.message : String(error);
            });
            scheduleSilenceReconcile();
          });
      }, BACKGROUND_ATTACH_SILENCE_RECONCILE_MS);
    };
    scheduleSilenceReconcile();
    attachRunUpdates({
      runId: run.runId,
      signal: controller.signal,
      onUpdate: (update) => {
        if (this.runs.get(run.conversationId) !== runHandle) {
          return;
        }
        terminalUpdateReceived = terminalUpdateReceived || update.done || !isLiveRunStatus(update.status);
        runInAction(() => {
          this.skipNextSave = true;
          this.state = patchActiveRunUpdate(this.state, update);
          this.loadError = null;
        });
        if (terminalUpdateReceived) {
          clearSilenceTimer();
        } else {
          scheduleSilenceReconcile();
        }
      },
    })
      .catch((error) => {
        if (controller.signal.aborted || runHandle.canceled) {
          return;
        }
        attachErrorMessage = error instanceof Error ? error.message : String(error);
        runInAction(() => {
          this.loadError = attachErrorMessage;
        });
      })
      .finally(() => {
        clearSilenceTimer();
        if (this.runs.get(run.conversationId) === runHandle) {
          this.runs.delete(run.conversationId);
        }
        if (!controller.signal.aborted && !runHandle.canceled && !terminalUpdateReceived) {
          runInAction(() => {
            this.loadError = attachErrorMessage ?? translate(this.state.settings.general.locale, "runUpdateStreamDisconnected");
          });
          void this.refreshBackgroundRuns();
        }
      });
  }

  find(id: string): ConversationSummary | null {
    return findConversation(this.state, id);
  }

  cwdOf(id: string): string | undefined {
    return conversationCwd(this.state, id);
  }

  basePathOf(id: string): string | undefined {
    return conversationBasePath(this.state, id);
  }

  setWorktree(id: string, worktreePath: string | undefined): void {
    this.patchConv(id, { worktreePath });
  }

  setConversationView(id: string, view: ConversationView): void {
    this.patchConv(id, { view });
  }

  select(id: string): void {
    let selected = false;
    this.setState((current) => {
      if (!findConversation(current, id)) {
        return current;
      }
      selected = true;
      return patchConversation({ ...current, selectedId: id }, id, { unread: false });
    });
    if (selected) {
      this.enqueueMutations({ type: "setSelectedConversation", conversationId: id });
      void this.loadThread(id);
    }
  }

  newChat(profile: AgentProfile): string {
    const id = nextId("chat");
    const thread = starterThread();
    let conversation: ConversationSummary | null = null;
    this.fullyLoadedThreadIds.add(id);
    this.setState((current) => {
      const locale = current.settings.general.locale;
      const conv: ConversationSummary = {
        id,
        title: translate(locale, "newChat"),
        snippet: translate(locale, "defaultConversationSnippet"),
        time: nowLabel(),
        status: "idle",
        agent: profile.agent,
        profile,
      };
      conversation = conv;
      return {
        ...current,
        chats: [conv, ...current.chats],
        threads: { ...current.threads, [id]: thread },
        selectedId: id,
      };
    });
    if (conversation) {
      this.enqueueMutations(
        { type: "upsertConversation", conversation, projectId: null, insertAtFront: true },
        { type: "upsertMessages", conversationId: id, messages: thread },
        { type: "setSelectedConversation", conversationId: id },
      );
      this.persistCurrentStateNow();
    }
    return id;
  }

  createProject(input: CreateProjectInput): CreatedProject {
    const name = input.name.trim();
    const path = input.path.trim();
    if (!name) {
      throw new Error("Project name is required.");
    }
    if (!path) {
      throw new Error("Project path is required.");
    }
    const projectId = projectIdFromName(name);
    const conversationId = nextId("chat");
    const thread = starterThread();
    this.fullyLoadedThreadIds.add(conversationId);
    const conversation: ConversationSummary = {
      id: conversationId,
      title: translate(this.state.settings.general.locale, "newChat"),
      snippet: translate(this.state.settings.general.locale, "defaultProjectConversationSnippet"),
      time: nowLabel(),
      status: "idle",
      agent: input.profile.agent,
      profile: input.profile,
    };
    this.setState((current) => {
      if (current.projects.some((project) => project.id === projectId)) {
        throw new Error(`Project ${projectId} already exists.`);
      }
      const project: Project = { id: projectId, name, path, conversations: [conversation] };
      return {
        ...current,
        projects: [project, ...current.projects],
        threads: { ...current.threads, [conversationId]: thread },
        selectedId: conversationId,
      };
    });
    this.enqueueMutations(
      { type: "upsertProject", project: { id: projectId, name, path }, insertAtFront: true },
      { type: "upsertConversation", conversation, projectId, insertAtFront: true },
      { type: "upsertMessages", conversationId, messages: thread },
      { type: "setSelectedConversation", conversationId },
    );
    this.persistCurrentStateNow();
    return { projectId, conversationId };
  }

  newProjectChat(projectId: string, profile: AgentProfile): string {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} was not found.`);
    }
    const id = nextId("chat");
    const thread = starterThread();
    let conversation: ConversationSummary | null = null;
    this.fullyLoadedThreadIds.add(id);
    this.setState((current) => {
      const locale = current.settings.general.locale;
      const conv: ConversationSummary = {
        id,
        title: translate(locale, "newChat"),
        snippet: translate(locale, "defaultConversationSnippet"),
        time: nowLabel(),
        status: "idle",
        agent: profile.agent,
        profile,
      };
      conversation = conv;
      return {
        ...current,
        projects: current.projects.map((item) => (item.id === projectId ? { ...item, conversations: [conv, ...item.conversations] } : item)),
        threads: { ...current.threads, [id]: thread },
        selectedId: id,
      };
    });
    if (conversation) {
      this.enqueueMutations(
        { type: "upsertConversation", conversation, projectId, insertAtFront: true },
        { type: "upsertMessages", conversationId: id, messages: thread },
        { type: "setSelectedConversation", conversationId: id },
      );
      this.persistCurrentStateNow();
    }
    return id;
  }

  setConversationProfile(id: string, profile: AgentProfile): void {
    this.patchConv(id, { agent: profile.agent, profile });
  }

  rename(id: string, title: string): void {
    const trimmed = title.trim();
    if (trimmed) {
      this.patchConv(id, { title: trimmed });
    }
  }

  togglePin(id: string): void {
    const conversation = this.find(id);
    this.patchConv(id, { pinned: !conversation?.pinned });
  }

  private cancelActiveRun(id: string): void {
    const active = this.runs.get(id);
    if (active) {
      active.canceled = true;
      void cancelRun(active.runId).catch(() => undefined);
      active.controller.abort();
      this.runs.delete(id);
    }
  }

  archive(id: string): void {
    this.cancelActiveRun(id);
    this.setState((current) => ({
      ...patchConversation(current, id, { archived: true, pinned: false, activeRunId: undefined, status: "idle" }),
      selectedId: current.selectedId === id ? "" : current.selectedId,
    }));
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    if (!this.selectedId) {
      this.enqueueMutations({ type: "setSelectedConversation", conversationId: "" });
    }
    this.persistCurrentStateNow();
  }

  remove(id: string): string {
    this.cancelActiveRun(id);
    this.pendingMessages.delete(id);
    this.fullyLoadedThreadIds.delete(id);
    this.threadLoads.delete(id);
    let nextSelectedId = this.state.selectedId;
    this.setState((current) => {
      const threads = { ...current.threads };
      const composerDrafts = { ...current.composerDrafts };
      delete threads[id];
      delete composerDrafts[id];
      const nextState = {
        ...current,
        chats: current.chats.filter((c) => c.id !== id),
        projects: current.projects.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.id !== id) })),
        threads,
        composerDrafts,
      };
      nextSelectedId =
        current.selectedId === id || !findConversation(nextState, current.selectedId)
          ? (workspaceConversations(nextState).find((conversation) => !conversation.archived)?.id ?? workspaceConversations(nextState)[0]?.id ?? "")
          : current.selectedId;
      return {
        ...nextState,
        selectedId: nextSelectedId,
      };
    });
    this.dirtyThreadVersions.delete(id);
    this.enqueueMutations({ type: "deleteConversation", conversationId: id }, { type: "setSelectedConversation", conversationId: nextSelectedId });
    this.persistCurrentStateNow();
    if (nextSelectedId) {
      void this.loadThread(nextSelectedId);
    }
    return nextSelectedId;
  }

  sendMessage(id: string, text: string): void {
    const userMsg: ChatMessage = { id: nextId("u"), role: "user", text, time: nowLabel() };
    this.setState((current) =>
      patchConversation(
        {
          ...current,
          threads: { ...current.threads, [id]: [...(current.threads[id] ?? []), userMsg] },
        },
        id,
        { archived: false },
      ),
    );
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: userMsg });
    // If the agent is still working, queue this turn instead of cancelling it —
    // it dispatches automatically when the current run settles (see drainPendingMessages).
    if (this.runs.has(id)) {
      const queue = this.pendingMessages.get(id) ?? [];
      queue.push(userMsg);
      this.pendingMessages.set(id, queue);
      this.persistCurrentStateNow();
      return;
    }
    this.runTurn(id, userMsg);
  }

  pendingMessageCount(id: string): number {
    return this.pendingMessages.get(id)?.length ?? 0;
  }

  sendQueuedMessageNow(id: string): boolean {
    const queue = this.pendingMessages.get(id);
    if (!queue || queue.length === 0) {
      return false;
    }
    const next = queue.shift();
    if (queue.length === 0) {
      this.pendingMessages.delete(id);
    }
    if (!next) {
      return false;
    }
    this.runTurn(id, next);
    return true;
  }

  /** Dispatch the next queued user message for a conversation, if any. Called
   *  when a run settles so queued turns run in order without interrupting. */
  private drainPendingMessages(id: string): void {
    if (this.runs.has(id)) {
      return;
    }
    const queue = this.pendingMessages.get(id);
    if (!queue || queue.length === 0) {
      return;
    }
    this.sendQueuedMessageNow(id);
  }

  /** Update this conversation's compaction preferences (auto on/off + window
   *  override). Stores only non-default values to keep persisted state tidy. */
  setCompaction(id: string, patch: Partial<CompactionSettings>): void {
    this.setState((current) => {
      const merged: CompactionSettings = { ...(findConversation(current, id)?.compaction ?? {}), ...patch };
      // Keep `auto` only when explicitly off (true is the default) and `window`
      // only when a positive override is set — otherwise drop back to undefined.
      const cleaned: CompactionSettings = {
        ...(merged.auto === false ? { auto: false } : {}),
        ...(typeof merged.window === "number" && merged.window > 0 ? { window: merged.window } : {}),
      };
      return patchConversation(current, id, { compaction: Object.keys(cleaned).length > 0 ? cleaned : undefined });
    });
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    this.persistCurrentStateNow();
  }

  /** Force a compaction of the conversation now. Best-effort per agent: sends the
   *  agent's compact command (`/compact`, Gemini `/compress`) as a turn on the
   *  resumed session. Returns false when there is no live same-agent session to
   *  compact (nothing has run yet), so the caller can surface a hint. */
  compactConversation(id: string): boolean {
    // Never start a compaction while a run is in flight: runTurn would cancel it,
    // and resuming the same native session under a second concurrent run strands
    // both turns (an empty agent bubble that hangs "thinking"). The composer also
    // disables the trigger while running; this is the safety net.
    if (this.runs.has(id)) {
      return false;
    }
    const conv = this.find(id);
    const profile = conversationProfile(conv);
    if (!conversationSessionId(conv, profile.agent)) {
      return false;
    }
    const userMsg: ChatMessage = {
      id: nextId("u"),
      role: "user",
      text: translate(this.state.settings.general.locale, "compactionRequested"),
      time: nowLabel(),
    };
    this.setState((current) => ({
      ...current,
      chats: current.chats.map((conversation) =>
        conversation.id === id
          ? { ...conversation, usage: { ...(conversation.usage ?? {}), contextTokens: 0 } }
          : conversation,
      ),
      projects: current.projects.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) =>
          conversation.id === id
            ? { ...conversation, usage: { ...(conversation.usage ?? {}), contextTokens: 0 } }
            : conversation,
        ),
      })),
      threads: { ...current.threads, [id]: [...(current.threads[id] ?? []), userMsg] },
    }));
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation }, { type: "upsertMessage", conversationId: id, message: userMsg });
    }
    this.runTurn(id, userMsg, { promptOverride: compactCommandForAgent(profile.agent), initialContextTokens: 0 });
    return true;
  }

  /** Appends the batched review comments as a single block to the thread without
   *  starting an agent run (the user decides when to actually prompt the agent). */
  addReviewComments(id: string, comments: readonly ReviewCommentEntry[]): void {
    if (comments.length === 0) {
      return;
    }
    const message: ChatMessage = { id: nextId("u"), role: "user", time: nowLabel(), blocks: [{ kind: "review", comments: [...comments] }] };
    this.setState((current) => ({
      ...current,
      threads: { ...current.threads, [id]: [...(current.threads[id] ?? []), message] },
    }));
    this.markThreadDirty(id);
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message });
    this.persistCurrentStateNow();
  }

  /** Run (or re-run) the agent for an existing user message in the thread.
   *  `promptOverride` sends a different prompt to the agent than the message text
   *  shows (used by manual compaction, where the bubble reads "Compact context"
   *  but the agent receives its `/compact` command). */
  private runTurn(id: string, userMsg: ChatMessage, options?: { readonly promptOverride?: string; readonly initialContextTokens?: number }): void {
    const conv = this.find(id);
    const profile = conversationProfile(conv);
    const isDefaultTitle = isDefaultConversationTitle(conv?.title);
    const text = userMsg.text ?? "";
    // Each agent gets its own native session branch. Returning to an agent
    // resumes that branch; first use of another agent replays the shared
    // transcript into a fresh native session.
    const resume = conversationSessionId(conv, profile.agent);
    const canResume = Boolean(resume);
    let prompt: string;
    if (options?.promptOverride !== undefined) {
      prompt = options.promptOverride;
    } else if (canResume) {
      prompt = text;
    } else {
      const thread = this.state.threads[id] ?? [];
      const userIndex = thread.findIndex((message) => message.id === userMsg.id);
      const priorMessages = userIndex >= 0 ? thread.slice(0, userIndex) : thread.filter((message) => message.id !== userMsg.id);
      prompt = buildAgentPrompt(priorMessages, text);
    }
    const runId = nextId("run");

    // Cancel any run still in flight for this conversation BEFORE persisting the
    // (re-truncated) thread. Otherwise a server-owned background run can write the
    // old agent reply back into storage after our save, so it reappears on reload.
    const previous = this.runs.get(id);
    if (previous) {
      previous.canceled = true;
      void cancelRun(previous.runId).catch(() => undefined);
      previous.controller.abort();
      this.runs.delete(id);
    }

    const runningPatch: Partial<ConversationSummary> = {
      activeRunId: runId,
      status: "running" as ConversationStatus,
      snippet: truncate(text, 60),
      time: nowLabel(),
      unread: false,
      costUsd: undefined,
      usage: options?.initialContextTokens === undefined ? undefined : { ...(conv?.usage ?? {}), contextTokens: options.initialContextTokens },
    };
    const conversationPatch = isDefaultTitle ? { ...runningPatch, title: truncate(text, 40) } : runningPatch;
    this.setState((current) => patchConversation(current, id, conversationPatch));
    const runningConversation = this.find(id);
    if (runningConversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: runningConversation });
    }
    this.persistCurrentStateNow();

    const aId = nextId("a");
    const agentTime = nowLabel();
    const agentStartedAtMs = Date.now();
    // Create the agent message up-front (empty) so the thread shows a single
    // continuous "thinking" bubble that streams content in place — no separate
    // typing placeholder that pops out and gets replaced (which read as a flicker).
    this.setState((current) => {
      const arr = current.threads[id] ?? [];
      if (arr.some((m) => m.id === aId)) {
        return current;
      }
      return { ...current, threads: { ...current.threads, [id]: upsertAgentMessageForUserTurn(arr, userMsg.id, { id: aId, role: "agent", time: agentTime, startedAtMs: agentStartedAtMs, profile, blocks: [] }) } };
    });
    this.markThreadDirty(id);
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: { id: aId, role: "agent", time: agentTime, startedAtMs: agentStartedAtMs, profile, blocks: [] } });
    const applyBlocks = (blocks: AgentBlock[]) => {
      let shouldFlush = false;
      let shouldPersistBlocks = true;
      let persistedMessage: ChatMessage | null = null;
      this.setState((current) => {
        const arr = current.threads[id] ?? [];
        const previousBlocks = arr.find((m) => m.id === aId)?.blocks;
        const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
        const needsInput = blocksNeedInput(mergedBlocks);
        if (runHandle.serverOwned && !needsInput && blocksHaveLiveOutput(mergedBlocks)) {
          this.skipNextSave = true;
          shouldPersistBlocks = false;
        }
        shouldFlush = needsInput || blocksHaveStatus(mergedBlocks);
        const message: ChatMessage = { id: aId, role: "agent", time: agentTime, startedAtMs: agentStartedAtMs, profile, blocks: mergedBlocks };
        persistedMessage = message;
        const nextState = {
          ...current,
          threads: {
            ...current.threads,
            [id]: upsertAgentMessageForUserTurn(arr, userMsg.id, message),
          },
        };
        // After cancellation, still let the final blocks settle (so the message
        // doesn't stay stuck "thinking"), but never revive the status — stopRun
        // already moved it to idle.
        if (runHandle.canceled) {
          return nextState;
        }
        return needsInput
          ? patchConversation(nextState, id, { status: "waiting", snippet: translate(current.settings.general.locale, "runNeedsInputSnippet"), time: nowLabel() })
          : nextState;
      });
      if (shouldPersistBlocks) {
        this.markThreadDirty(id);
        if (persistedMessage) {
          this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: persistedMessage });
        }
        const conversation = this.find(id);
        if (conversation && (shouldFlush || conversation.status === "waiting")) {
          this.enqueueMutations({ type: "updateConversation", conversation });
        }
      }
      if (shouldFlush) {
        this.persistCurrentStateNow();
      }
    };

    const controller = new AbortController();
    const runHandle: RunHandle = { controller, runId, serverOwned: false, canceled: false };
    this.runs.set(id, runHandle);

    runConversation({
      profile,
      prompt,
      resume,
      compaction: conv?.compaction,
      cwd: this.cwdOf(id),
      accessMode: accessModeForAgentProfile(profile),
      locale: this.state.settings.general.locale,
      binding: {
        conversationId: id,
        runId,
        userMessageId: userMsg.id,
        userMessageTime: userMsg.time ?? nowLabel(),
        agentMessageId: aId,
        agentMessageTime: agentTime,
      },
      signal: controller.signal,
      onAccepted: () => {
        runHandle.serverOwned = true;
      },
      onSession: (sessionId) => {
        // Persist the native session id for this agent branch so switching away
        // and back can resume it without replaying the transcript.
        this.setState((current) => patchConversationAgentSession(current, id, profile.agent, sessionId));
        const conversation = this.find(id);
        if (conversation) {
          this.enqueueMutations({ type: "updateConversation", conversation });
        }
        this.persistCurrentStateNow();
      },
      onBlocks: applyBlocks,
    })
      .then((result) => {
        if (runHandle.canceled || !isSettledRunConversationResult(result)) {
          return;
        }
        this.setState((current) => {
          const runState = result.status === "error" ? "error" : "ok";
          const settled = finishThreadLiveBlocks(current, id, runState);
          const withConversation = patchConversation(settled, id, finalRunPatch(settled, id, aId, result));
          return patchAgentMessageUsage(withConversation, id, aId, result);
        });
        this.markThreadDirty(id);
        const conversation = this.find(id);
        const message = this.state.threads[id]?.find((item) => item.id === aId);
        if (conversation) {
          this.enqueueMutations({ type: "updateConversation", conversation });
        }
        if (message) {
          this.enqueueMutations({ type: "upsertMessage", conversationId: id, message });
        }
        this.persistCurrentStateNow();
      })
      .catch(() => {
        if (!runHandle.canceled) {
          this.setState((current) => patchConversation(settleThreadLiveBlocks(current, id), id, { activeRunId: undefined, status: "error", snippet: translate(current.settings.general.locale, "runFailedSnippet") }));
          this.markThreadDirty(id);
          const conversation = this.find(id);
          if (conversation) {
            this.enqueueMutations({ type: "updateConversation", conversation });
          }
          this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
          this.persistCurrentStateNow();
        }
      })
      .finally(() => {
        if (this.runs.get(id) === runHandle) {
          this.runs.delete(id);
        }
        // Dispatch the next queued turn once this run is fully cleared. Skip if
        // the run was cancelled (the user stopped, or a newer turn took over).
        if (!runHandle.canceled) {
          this.drainPendingMessages(id);
        }
      });
  }

  stopRun(id: string): void {
    const active = this.runs.get(id);
    if (active) {
      active.canceled = true;
      void cancelRun(active.runId).catch(() => undefined);
      active.controller.abort();
      this.runs.delete(id);
    } else {
      const activeRunId = this.find(id)?.activeRunId;
      if (activeRunId) {
        void cancelRun(activeRunId).catch(() => undefined);
      }
    }
    // Reset the conversation even when there is no live run handle (e.g. a
    // seeded "running" conversation, or one left "running" after a decision):
    // otherwise the stop button would hang with nothing to cancel.
    this.setState((current) => {
      // Stop the "working" animation on any in-flight blocks even if the run
      // handle is already gone.
      const settled = settleThreadLiveBlocks(current, id);
      const conversation = findConversation(settled, id);
      if (!conversation || (conversation.status !== "running" && conversation.status !== "waiting")) {
        return settled;
      }
      return patchConversation(settled, id, {
        activeRunId: undefined,
        status: "idle",
        snippet: translate(current.settings.general.locale, "runCanceledSnippet"),
        time: nowLabel(),
      });
    });
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
    this.persistCurrentStateNow();
  }

  retryMessage(id: string, messageId: string): void {
    const thread = this.state.threads[id] ?? [];
    // Retry is triggered from the AGENT reply (its message id), so locate that
    // message and walk back to the user turn that produced it. (Also works when
    // invoked directly on a user message.)
    const target = thread.findIndex((message) => message.id === messageId);
    if (target < 0) {
      return;
    }
    let userIndex = -1;
    for (let cursor = target; cursor >= 0; cursor -= 1) {
      if (thread[cursor].role === "user") {
        userIndex = cursor;
        break;
      }
    }
    if (userIndex < 0) {
      return;
    }
    const userMsg = thread[userIndex];
    // Drop everything after this user message (the stale agent reply) and re-run
    // it in place — no duplicate user turn.
    this.setState((current) => ({ ...current, threads: { ...current.threads, [id]: thread.slice(0, userIndex + 1) } }));
    this.markThreadDirty(id);
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
    this.runTurn(id, userMsg);
  }

  forkConversationFromMessage(id: string, messageId: string): string | null {
    let forkId: string | null = null;
    this.setState((current) => {
      const source = findConversation(current, id);
      const thread = current.threads[id] ?? [];
      const messageIndex = thread.findIndex((message) => message.id === messageId && message.role === "agent");
      const message = messageIndex >= 0 ? thread[messageIndex] : undefined;
      if (!source || !message || message.role !== "agent") {
        return current;
      }

      forkId = nextId("chat");
      const locale = current.settings.general.locale;
      const profile = normalizeAgentProfile(message.profile ?? source.profile, message.profile?.agent ?? source.agent);
      const conversation: ConversationSummary = {
        ...source,
        id: forkId,
        title: truncate(translate(locale, "forkedConversationTitle", { title: source.title }), 80),
        snippet: snippetFromBlocks(message.blocks, locale),
        time: nowLabel(),
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
      this.fullyLoadedThreadIds.add(forkId);
      const forkThread = thread.slice(0, messageIndex + 1).map(cloneMessageForFork);
      const projects = current.projects.map((project) =>
        project.conversations.some((item) => item.id === id)
          ? { ...project, conversations: [conversation, ...project.conversations] }
          : project,
      );
      const inProject = projects.some((project) => project.conversations[0]?.id === forkId);
      return {
        ...current,
        chats: inProject ? current.chats : [conversation, ...current.chats],
        projects,
        threads: { ...current.threads, [forkId]: forkThread },
        selectedId: forkId,
      };
    });
    if (forkId) {
      this.markThreadDirty(forkId);
      const conversation = this.find(forkId);
      const projectId = projectIdForConversation(this.state, forkId);
      if (conversation) {
        this.enqueueMutations(
          { type: "upsertConversation", conversation, projectId, insertAtFront: true },
          { type: "upsertMessages", conversationId: forkId, messages: this.state.threads[forkId] ?? [] },
          { type: "setSelectedConversation", conversationId: forkId },
        );
      }
      this.persistCurrentStateNow();
    }
    return forkId;
  }

  editAndResendMessage(id: string, messageId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const thread = this.state.threads[id] ?? [];
    const index = thread.findIndex((message) => message.role === "user" && message.id === messageId);
    if (index < 0) {
      return;
    }
    // The edit textarea holds only the visible text (attachments were stripped
    // for display), so re-append the original attachment blocks — otherwise
    // editing + resending silently drops the attached files.
    const attachmentBlocks = extractAttachmentBlocks(thread[index].text ?? "");
    const nextText = attachmentBlocks ? `${trimmed}\n\n${attachmentBlocks}` : trimmed;
    // Replace the edited user message, drop everything after it, and re-run.
    const userMsg: ChatMessage = { ...thread[index], text: nextText, time: nowLabel() };
    this.setState((current) => ({ ...current, threads: { ...current.threads, [id]: [...thread.slice(0, index), userMsg] } }));
    this.markThreadDirty(id);
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
    this.runTurn(id, userMsg);
  }

  decideApproval(id: string, approvalId: string, decision: ApprovalDecision): void {
    this.setState((current) => patchConversation(patchApprovalDecision(current, id, approvalId, decision), id, { status: "running", time: nowLabel() }));
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
    this.persistCurrentStateNow();
  }

  selectOptions(id: string, optionBlockId: string, selectedLabels: readonly string[]): void {
    this.setState((current) => patchConversation(patchOptionSelection(current, id, optionBlockId, selectedLabels), id, { status: "running", time: nowLabel() }));
    this.markThreadDirty(id);
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: this.state.threads[id] ?? [] });
    this.persistCurrentStateNow();
  }

  updateComposerDraft(id: string, draft: ComposerDraft): void {
    this.setState((current) => {
      const nextDraft: ComposerDraft = {
        text: draft.text,
        attachments: draft.attachments.map((attachment) => ({ ...attachment })),
      };
      const currentDraft = current.composerDrafts[id] ?? { text: "", attachments: [] };
      if (serializableEqual(currentDraft, nextDraft)) {
        return current;
      }
      return {
        ...current,
        composerDrafts: {
          ...current.composerDrafts,
          [id]: nextDraft,
        },
      };
    });
    const nextDraft = this.state.composerDrafts[id] ?? { text: "", attachments: [] };
    this.enqueueMutations(
      nextDraft.text.trim().length === 0 && nextDraft.attachments.length === 0
        ? { type: "deleteComposerDraft", conversationId: id }
        : { type: "setComposerDraft", conversationId: id, draft: nextDraft },
    );
  }

  updateSettings(patch: AppSettingsPatch): void {
    this.setState((current) => ({
      ...current,
      settings: mergeAppSettings(current.settings, patch),
    }));
    this.enqueueMutations({ type: "setSettings", settings: this.state.settings });
    this.persistCurrentStateNow();
  }

  private patchConv(id: string, patch: Partial<ConversationSummary>): void {
    this.setState((current) => patchConversation(current, id, patch));
    const conversation = this.find(id);
    if (conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation });
      this.persistCurrentStateNow();
    }
  }

  private setState(updater: (current: WorkspaceState) => WorkspaceState): void {
    this.state = updater(this.state);
  }
}

/** Stateful workspace: conversations (chats + project groups), per-conversation
 * threads, and operations that mutate them while agent runs stream through the
 * dev backend. The source of truth is a MobX store; the hook bridges observable
 * updates into React renders for components that are not wrapped in observer(). */
export function useWorkspace(): Workspace {
  const [store] = useState(() => new WorkspaceStore());
  const [, setVersion] = useState(0);

  useEffect(() => {
    const rerender = reaction(
      () => [store.state, store.loaded, store.loading, store.loadError] as const,
      () => setVersion((version) => version + 1),
    );
    store.mount();
    return () => {
      rerender();
      store.unmount();
    };
  }, [store]);

  return store;
}
