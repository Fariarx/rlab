import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { accessModeForAgentProfile, compactCommandForAgent, normalizeAgentProfile, type AgentBlock, type AgentProfile, type ApprovalDecision, type ChatMessage, type CompactionSettings, type ComposerDraft, type ConversationStatus, type ConversationSummary, type ConversationView, type Project, type ReviewCommentEntry } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { attachRunUpdates, cancelRun, loadActiveRuns, runConversation, type ActiveRunSnapshot } from "./run-agent";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, type Locale, mergeAppSettings } from "./app-settings";
import type { WorkspaceMutation } from "../../lib/workspace-mutations";
import { applyRlabEventToState, type RecordedRlabEvent, type RlabEvent, workspaceMutationToCommand } from "../../lib/rlab-events";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./workspace-state";
import { conversationPreviewSnippet, previewSnippet } from "../../lib/conversation-preview";
import {
  blocksHaveLiveOutput,
  blocksHaveStatus,
  blocksNeedInput,
  cloneMessageForFork,
  finalRunPatch,
  finishThreadLiveBlocks,
  isLiveRunStatus,
  isSettledRunConversationResult,
  mergeInputBlockState,
  patchActiveRunUpdate,
  patchAgentMessageUsage,
  preserveLiveActiveRunMessages,
  settleThreadLiveBlocks,
  snippetFromStateThread,
  upsertAgentMessageForUserTurn,
} from "./workspace-run-state";
import {
  buildAgentPrompt,
  conversationBasePath,
  conversationCwd,
  conversationProfile,
  conversationSessionId,
  extractAttachmentBlocks,
  findConversation,
  isDefaultConversationTitle,
  patchApprovalDecision,
  patchConversation,
  patchConversationAgentSession,
  patchOptionSelection,
  projectIdForConversation,
  projectIdFromName,
  projectMeta,
  serializableEqual,
  workspaceConversations,
} from "./workspace-state-utils";
export { buildAgentPrompt, conversationProfile } from "./workspace-state-utils";

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
  readonly userMessageId: string;
  readonly agentMessageId: string;
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

type WorkspaceStatePayload = WorkspaceState & { readonly checkpoint?: string };
type CommandResponsePayload = { readonly checkpoint?: string };

async function loadWorkspaceState(): Promise<WorkspaceStatePayload> {
  const response = await fetch("/api/state/snapshot", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace load failed (${response.status})`));
  }
  return (await response.json()) as WorkspaceStatePayload;
}

async function saveWorkspaceMutations(mutations: readonly WorkspaceMutation[], clientId: string): Promise<number | undefined> {
  if (mutations.length === 0) {
    return undefined;
  }
  const response = await fetch("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: mutations.map((mutation) => {
        const commandId = nextId("cmd");
        return {
          commandId,
          clientId,
          correlationId: commandId,
          command: workspaceMutationToCommand(mutation),
        };
      }),
    }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace save failed (${response.status})`));
  }
  const payload = (await response.json().catch(() => null)) as CommandResponsePayload | null;
  const checkpoint = typeof payload?.checkpoint === "string" ? Number.parseInt(payload.checkpoint, 10) : undefined;
  return typeof checkpoint === "number" && Number.isFinite(checkpoint) ? checkpoint : undefined;
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

export class WorkspaceStore implements Workspace {
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

  private workspaceRevision = 0;

  private eventSource: EventSource | null = null;

  private readonly clientId = nextId("client");

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
    makeObservable(this, {
      state: observable.ref,
      loadError: observable,
      loaded: observable,
      loading: observable,
      chats: computed,
      projects: computed,
      threads: computed,
      composerDrafts: computed,
      selectedId: computed,
      settings: computed,
      loadThread: action.bound,
      loadAllThreads: action.bound,
      mount: action.bound,
      unmount: action.bound,
      reloadWorkspace: action.bound,
      select: action.bound,
      newChat: action.bound,
      createProject: action.bound,
      newProjectChat: action.bound,
      setConversationProfile: action.bound,
      rename: action.bound,
      togglePin: action.bound,
      archive: action.bound,
      remove: action.bound,
      sendMessage: action.bound,
      sendQueuedMessageNow: action.bound,
      setCompaction: action.bound,
      setConversationView: action.bound,
      compactConversation: action.bound,
      addReviewComments: action.bound,
      stopRun: action.bound,
      retryMessage: action.bound,
      forkConversationFromMessage: action.bound,
      editAndResendMessage: action.bound,
      decideApproval: action.bound,
      selectOptions: action.bound,
      updateComposerDraft: action.bound,
      updateSettings: action.bound,
    });
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

  private startEventStream(): void {
    if (typeof EventSource === "undefined") {
      return;
    }
    this.eventSource?.close();
    const source = new EventSource(`/api/state/events?from=${encodeURIComponent(String(this.workspaceRevision))}`);
    source.addEventListener("rlab", (event) => {
      const parsed = JSON.parse(event.data) as RecordedRlabEvent;
      const position = Number.parseInt(parsed.globalPosition, 10);
      if (!Number.isFinite(position) || position <= this.workspaceRevision) {
        return;
      }
      if (position > this.workspaceRevision + 1) {
        runInAction(() => {
          this.loadError = "Workspace event stream gap detected.";
        });
        this.reloadWorkspace();
        return;
      }
      runInAction(() => {
        const nextState = applyRlabEventToState(this.state, { type: parsed.type, data: parsed.data, metadata: parsed.metadata } as RlabEvent);
        this.workspaceRevision = position;
        if (!serializableEqual(this.state, nextState)) {
          this.skipNextSave = true;
          this.state = preserveLiveActiveRunMessages(nextState, this.state, this.runs);
        }
        this.loadError = null;
      });
    });
    source.onerror = () => {
      runInAction(() => {
        this.loadError = "Workspace event stream disconnected.";
      });
    };
    this.eventSource = source;
  }

  /** Lazily fetch a conversation's full message thread (the GET shell omits all
   *  but the selected one). No-op once fully held; never triggers a save. */
  loadThread(id: string): Promise<void> {
    return this.loadThreadFromServer(id, false);
  }

  private loadThreadFromServer(id: string, force: boolean): Promise<void> {
    if (!id || (!force && this.fullyLoadedThreadIds.has(id))) {
      return Promise.resolve();
    }
    const existing = this.threadLoads.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const response = await fetch(`/api/state/thread?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
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
    this.eventSource?.close();
    this.eventSource = null;
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

  private currentMessage(conversationId: string, messageId: string): ChatMessage | null {
    return this.state.threads[conversationId]?.find((message) => message.id === messageId) ?? null;
  }

  private rebaseMutationOnCurrentState(mutation: WorkspaceMutation): WorkspaceMutation {
    switch (mutation.type) {
      case "setSelectedConversation":
      case "deleteConversation":
      case "deleteComposerDraft":
        return mutation;
      case "setSettings":
        return { ...mutation, settings: this.state.settings };
      case "upsertProject": {
        const project = this.state.projects.find((item) => item.id === mutation.project.id);
        return project ? { ...mutation, project: projectMeta(project) } : mutation;
      }
      case "upsertConversation": {
        const conversation = findConversation(this.state, mutation.conversation.id);
        return conversation ? { ...mutation, conversation, projectId: projectIdForConversation(this.state, conversation.id) } : mutation;
      }
      case "updateConversation": {
        const conversation = findConversation(this.state, mutation.conversation.id);
        return conversation ? { ...mutation, conversation } : mutation;
      }
      case "setComposerDraft": {
        const draft = this.state.composerDrafts[mutation.conversationId];
        return draft ? { ...mutation, draft } : mutation;
      }
      case "upsertMessage": {
        const message = this.currentMessage(mutation.conversationId, mutation.message.id);
        return message ? { ...mutation, message } : mutation;
      }
      case "upsertMessages": {
        const thread = this.state.threads[mutation.conversationId];
        return thread
          ? {
              ...mutation,
              messages: mutation.messages.map((message) => thread.find((current) => current.id === message.id) ?? message),
            }
          : mutation;
      }
      case "replaceConversationThread": {
        const thread = this.state.threads[mutation.conversationId];
        return thread ? { ...mutation, messages: thread } : mutation;
      }
    }
  }

  private rebaseMutationsOnCurrentState(mutations: readonly WorkspaceMutation[]): WorkspaceMutation[] {
    return mutations.map((mutation) => this.rebaseMutationOnCurrentState(mutation));
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
    const mutations = this.rebaseMutationsOnCurrentState(this.pendingMutations);
    this.pendingMutations = [];
    this.pendingSaveUrgent = false;
    this.saveInFlight = true;
    let saveFailed = false;
    try {
      await saveWorkspaceMutations(mutations, this.clientId);
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
          this.workspaceRevision = typeof loadedState.checkpoint === "string" ? Number.parseInt(loadedState.checkpoint, 10) || 0 : 0;
          this.applyServerState(cloneWorkspaceState(loadedState));
          this.loadError = null;
          this.loaded = true;
          this.hydrated = true;
        });
        this.startEventStream();
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
      const loadedThread = loaded.threads[id] ?? current.threads[id] ?? [];
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
        const snippet = conversationPreviewSnippet(loadedThread, 60);
        next = patchConversation(settleThreadLiveBlocks(next, id), id, {
          activeRunId: undefined,
          status: "error",
          ...(snippet ? { snippet } : {}),
        });
        continue;
      }
      if (!serializableEqual(currentConversation, loadedConversation)) {
        next = patchConversation(next, id, loadedConversation);
      }
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
    const runHandle: RunHandle = { controller, runId: run.runId, userMessageId: run.userMessageId, agentMessageId: run.agentMessageId, serverOwned: true, canceled: false };
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
      snippet: previewSnippet(text, 60),
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
        if (!needsInput) {
          return nextState;
        }
        const snippet = snippetFromStateThread(nextState, id);
        return patchConversation(nextState, id, { status: "waiting", ...(snippet ? { snippet } : {}), time: nowLabel() });
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
    const runHandle: RunHandle = { controller, runId, userMessageId: userMsg.id, agentMessageId: aId, serverOwned: false, canceled: false };
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
          this.setState((current) => {
            const settled = settleThreadLiveBlocks(current, id);
            const snippet = snippetFromStateThread(settled, id);
            return patchConversation(settled, id, { activeRunId: undefined, status: "error", ...(snippet ? { snippet } : {}) });
          });
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
      const snippet = snippetFromStateThread(settled, id);
      return patchConversation(settled, id, {
        activeRunId: undefined,
        status: "idle",
        ...(snippet ? { snippet } : {}),
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
        snippet: conversationPreviewSnippet([message], 60),
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
      const forkThread = thread.slice(0, messageIndex + 1).map((threadMessage) => cloneMessageForFork(threadMessage, nextId));
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
 * dev backend. The source of truth is a MobX store; React components consuming
 * it must be wrapped in observer() so MobX, not a hook bridge, drives renders. */
export function useWorkspace(): Workspace {
  const [store] = useState(() => new WorkspaceStore());

  useEffect(() => {
    store.mount();
    return () => {
      store.unmount();
    };
  }, [store]);

  return store;
}
