import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { accessModeForAgentProfile, compactCommandForAgent, type AgentBlock, type AgentProfile, type ApprovalDecision, type ChatMessage, type CompactionSettings, type ComposerDraft, type ConversationSummary, type ConversationView, type Project, type ReviewCommentEntry } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { cancelRun, loadActiveRuns, runConversation, type ActiveRunSnapshot } from "../../client/api/run-agent";
import {
  cancelPendingTurn,
  enqueuePendingTurn,
  loadPendingTurnQueue,
  sendNextPendingTurn,
  setPendingTurnQueuePaused as setServerPendingTurnQueuePaused,
  type PendingTurnQueueSnapshot,
} from "../../client/api/workspace-page-api";
import { loadConversationThread, loadWorkspaceRevision, loadWorkspaceState } from "../../client/api/workspace-api";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, mergeAppSettings } from "../../lib/app-settings";
import type { WorkspaceMutation } from "../../lib/workspace-mutations";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "../../lib/workspace-state";
import { nextWorkspaceId, syncGeneratedWorkspaceIdSequence } from "../../lib/workspace-ids";
import {
  finalRunPatch,
  finishThreadLiveBlocks,
  isLiveRunStatus,
  isSettledRunConversationResult,
  patchActiveRunUpdate,
  patchAgentMessageUsage,
  settleThreadLiveBlocks,
  snippetFromStateThread,
  upsertAgentMessageForUserTurn,
} from "./models/workspace-run-state";
import {
  archiveConversationState,
  type ArchiveConversationStateResult,
  composerDraftMutation,
  createProjectConversationState,
  createProjectWithConversationState,
  createStandaloneConversationState,
  type ConversationMetadataStateResult,
  type ConversationStateCreation,
  type ProjectWithConversationStateCreation,
  forkConversationState,
  type ForkConversationStateResult,
  putComposerDraftState,
  renameConversationState,
  removeConversationState,
  stopRunConversationState,
  type StopRunConversationStateResult,
  toggleConversationPinState,
  updateConversationProfileState,
} from "./models/workspace-conversation-model";
import { hasUntrackedPersistedActiveRuns, mergeBackgroundRunState } from "./models/workspace-background-runs-model";
import { attachWorkspaceBackgroundRun, type RunHandle } from "./runtime/workspace-background-run-attachment";
import { mergeLoadedThread, mergeRemoteWorkspaceShell } from "./models/workspace-server-sync-model";
import { WorkspaceThreadLoader } from "./runtime/workspace-thread-loader";
import {
  appendCompactionRequestState,
  appendThreadMessageState,
  appendUserMessageTurnState,
  type AppendUserMessageStateResult,
  applyUserTurnSelectionState,
  decideApprovalState,
  editUserTurn,
  patchConversationCompactionState,
  retryUserTurn,
  selectOptionsState,
  type AgentInputResponseStateResult,
  type UserTurnSelectionStateResult,
} from "./models/workspace-thread-actions-model";
import {
  conversationBasePath,
  conversationCwd,
  conversationProfile,
  conversationSessionId,
  findConversation,
  patchConversation,
  patchConversationAgentSession,
  projectIdFromName,
  serializableEqual,
} from "./models/workspace-state-utils";
import { WorkspaceSaveQueue } from "./runtime/workspace-save-queue";
import { prepareWorkspaceRunTurn } from "./models/workspace-run-turn-model";
import { applyWorkspaceAgentBlocks } from "./models/workspace-agent-block-update-model";
export { buildAgentPrompt, conversationProfile } from "./models/workspace-state-utils";

const WORKSPACE_LOAD_RETRY_MS = 15_000;
const WORKSPACE_SYNC_POLL_MS = 2_000;

export interface CreateProjectInput {
  readonly name: string;
  readonly path: string;
  readonly profile: AgentProfile;
}

export interface CreatedProject {
  readonly projectId: string;
  readonly conversationId: string;
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
  readonly queuedMessages: (id: string) => readonly ChatMessage[];
  readonly cancelQueuedMessage: (id: string, messageId: string) => void;
  readonly sendQueuedMessageNow: (id: string) => boolean;
  readonly isQueuePaused: (id: string) => boolean;
  readonly setQueuePaused: (id: string, paused: boolean) => void;
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
  readonly isThreadLoaded: (id: string) => boolean;
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

  private workspaceRevision = 0;

  private syncInFlight = false;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private loadRetryTimer: ReturnType<typeof setInterval> | null = null;

  private readonly runs = new Map<string, RunHandle>();

  private readonly saveQueue = new WorkspaceSaveQueue({
    activeRuns: this.runs,
    applyServerState: (state) => {
      runInAction(() => this.applyServerState(state));
    },
    getLoadError: () => this.loadError,
    getRevision: () => this.workspaceRevision,
    getState: () => this.state,
    setLoadError: (error) => {
      runInAction(() => {
        this.loadError = error;
      });
    },
    setRevision: (revision) => {
      this.workspaceRevision = revision;
    },
  });
  private readonly pendingQueues = observable.map<string, PendingTurnQueueSnapshot>();

  private readonly queueRefreshInFlight = new Set<string>();

  private readonly threadLoader = new WorkspaceThreadLoader({
    loadConversationThread,
    onLoadedThread: (id, messages) => {
      runInAction(() => {
        this.state = mergeLoadedThread(this.state, id, messages);
      });
    },
    onLoadError: (message) => {
      runInAction(() => {
        this.loadError = message;
      });
    },
  });

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
      cancelQueuedMessage: action.bound,
      sendQueuedMessageNow: action.bound,
      setQueuePaused: action.bound,
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
    syncGeneratedWorkspaceIdSequence(state);
    // The shell ships only some threads (the selected one); those it does ship
    // are fully loaded. Reset the tracking to match the freshly loaded shell.
    this.threadLoader.resetLoadedThreads(Object.keys(state.threads));
    if (this.state !== state) {
      this.state = state;
    }
  }

  private hasPendingWorkspaceWrites(): boolean {
    return this.saveQueue.hasPendingWrites();
  }

  private applyRemoteServerState(serverState: WorkspaceState, preferredSelectedId: string): string {
    const merge = mergeRemoteWorkspaceShell({ current: this.state, serverState, preferredSelectedId, activeRuns: this.runs });
    const nextState = merge.state;
    syncGeneratedWorkspaceIdSequence(nextState);
    this.threadLoader.reconcileRemoteShell(merge);
    if (!serializableEqual(this.state, nextState)) {
      this.state = nextState;
    }
    return merge.selectedId;
  }

  /** Lazily fetch a conversation's full message thread (the GET shell omits all
   *  but the selected one). No-op once fully held; never triggers a save. */
  loadThread(id: string): Promise<void> {
    return this.threadLoader.loadThread(id);
  }

  isThreadLoaded(id: string): boolean {
    return this.threadLoader.isLoaded(id);
  }

  private loadThreadFromServer(id: string, force: boolean): Promise<void> {
    return this.threadLoader.loadThread(id, force);
  }

  private queueSnapshot(id: string): PendingTurnQueueSnapshot {
    return this.pendingQueues.get(id) ?? { conversationId: id, paused: false, messages: [] };
  }

  private setQueueSnapshot(snapshot: PendingTurnQueueSnapshot): void {
    this.pendingQueues.set(snapshot.conversationId, snapshot);
  }

  private refreshQueue(id: string): void {
    if (!id || this.queueRefreshInFlight.has(id)) {
      return;
    }
    this.queueRefreshInFlight.add(id);
    void loadPendingTurnQueue(id)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      })
      .finally(() => {
        this.queueRefreshInFlight.delete(id);
      });
  }

  private refreshSelectedQueue(): void {
    if (this.state.selectedId) {
      this.refreshQueue(this.state.selectedId);
    }
  }

  private conversationHasActiveWork(id: string): boolean {
    if (this.runs.has(id)) {
      return true;
    }
    const conversation = this.find(id);
    return Boolean(conversation?.activeRunId && isLiveRunStatus(conversation.status));
  }

  /** Ensure every conversation's thread is loaded — used before full-text search,
   *  which scans across all threads. */
  async loadAllThreads(): Promise<void> {
    const ids = [...this.state.chats, ...this.state.projects.flatMap((project) => project.conversations)].map((conversation) => conversation.id);
    await this.threadLoader.loadAllThreads(ids);
  }

  mount(): void {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.hydrated && !this.loading) {
          void this.refreshWorkspaceFromServer();
          void this.refreshBackgroundRuns();
          this.refreshSelectedQueue();
        }
      }, WORKSPACE_SYNC_POLL_MS);
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
    this.saveQueue.flushNow();
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
    this.saveQueue.dispose();
  }

  private enqueueMutations(...mutations: WorkspaceMutation[]): void {
    this.saveQueue.enqueue(...mutations);
  }

  private persistCurrentStateNow(): void {
    this.saveQueue.flushNow();
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
          this.workspaceRevision = typeof loadedState.revision === "number" ? loadedState.revision : 0;
          this.applyServerState(cloneWorkspaceState(loadedState));
          this.loadError = null;
          this.loaded = true;
          this.hydrated = true;
        });
        void this.refreshBackgroundRuns();
        this.refreshSelectedQueue();
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

  private async refreshWorkspaceFromServer(): Promise<void> {
    if (this.syncInFlight || !this.hydrated || this.loading || this.hasPendingWorkspaceWrites()) {
      return;
    }
    const seq = this.loadSeq;
    this.syncInFlight = true;
    try {
      const revision = await loadWorkspaceRevision();
      if (seq !== this.loadSeq || revision <= this.workspaceRevision || this.hasPendingWorkspaceWrites()) {
        return;
      }
      const loadedState = await loadWorkspaceState();
      if (seq !== this.loadSeq || this.hasPendingWorkspaceWrites()) {
        return;
      }
      if (typeof loadedState.revision !== "number") {
        throw new Error("Workspace state response is missing revision.");
      }
      const loadedRevision = loadedState.revision;
      if (loadedRevision <= this.workspaceRevision) {
        return;
      }
      let selectedId = "";
      runInAction(() => {
        const preferredSelectedId = this.state.selectedId;
        this.workspaceRevision = loadedRevision;
        selectedId = this.applyRemoteServerState(cloneWorkspaceState(loadedState), preferredSelectedId);
        this.loadError = null;
      });
      if (selectedId) {
        void this.loadThreadFromServer(selectedId, true);
        this.refreshQueue(selectedId);
      }
      void this.refreshBackgroundRuns();
    } catch (error) {
      if (seq !== this.loadSeq) {
        return;
      }
      runInAction(() => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
    } finally {
      this.syncInFlight = false;
    }
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
    if (hasUntrackedPersistedActiveRuns(this.state, this.runs)) {
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
        this.applyServerState(mergeBackgroundRunState({ current: this.state, loaded: loadedState, activeRunIds, trackedRuns: this.runs }));
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

  private attachBackgroundRun(run: ActiveRunSnapshot): void {
    attachWorkspaceBackgroundRun({
      run,
      runs: this.runs,
      applyUpdate: (update) => {
        runInAction(() => {
          this.state = patchActiveRunUpdate(this.state, update);
          this.loadError = null;
        });
      },
      disconnectedMessage: () => translate(this.state.settings.general.locale, "runUpdateStreamDisconnected"),
      reconcileBackgroundRuns: () => {
        void this.refreshBackgroundRuns();
      },
      setLoadError: (message) => {
        runInAction(() => {
          this.loadError = message;
        });
      },
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
      this.refreshQueue(id);
    }
  }

  newChat(profile: AgentProfile): string {
    const id = nextWorkspaceId("chat");
    const thread = starterThread();
    const creation: { current: ConversationStateCreation | null } = { current: null };
    this.threadLoader.markLoaded(id);
    this.setState((current) => {
      const locale = current.settings.general.locale;
      creation.current = createStandaloneConversationState({
        id,
        title: translate(locale, "newChat"),
        snippet: translate(locale, "defaultConversationSnippet"),
        time: nowLabel(),
        updatedAtMs: Date.now(),
        profile,
        state: current,
        thread,
      });
      return creation.current.state;
    });
    if (creation.current) {
      this.enqueueMutations(
        { type: "upsertConversation", conversation: creation.current.conversation, projectId: null, insertAtFront: true },
        { type: "upsertMessages", conversationId: id, messages: creation.current.thread },
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
    const conversationId = nextWorkspaceId("chat");
    const thread = starterThread();
    const creation: { current: ProjectWithConversationStateCreation | null } = { current: null };
    this.threadLoader.markLoaded(conversationId);
    this.setState((current) => {
      creation.current = createProjectWithConversationState({
        id: conversationId,
        project: { id: projectId, name, path },
        title: translate(current.settings.general.locale, "newChat"),
        snippet: translate(current.settings.general.locale, "defaultProjectConversationSnippet"),
        time: nowLabel(),
        updatedAtMs: Date.now(),
        profile: input.profile,
        state: current,
        thread,
      });
      return creation.current.state;
    });
    if (!creation.current) {
      throw new Error(`Project ${projectId} was not created.`);
    }
    this.enqueueMutations(
      { type: "upsertProject", project: creation.current.project, insertAtFront: true },
      { type: "upsertConversation", conversation: creation.current.conversation, projectId, insertAtFront: true },
      { type: "upsertMessages", conversationId, messages: creation.current.thread },
      { type: "setSelectedConversation", conversationId },
    );
    this.persistCurrentStateNow();
    return { projectId, conversationId };
  }

  newProjectChat(projectId: string, profile: AgentProfile): string {
    if (!this.state.projects.some((item) => item.id === projectId)) {
      throw new Error(`Project ${projectId} was not found.`);
    }
    const id = nextWorkspaceId("chat");
    const thread = starterThread();
    const creation: { current: ConversationStateCreation | null } = { current: null };
    this.threadLoader.markLoaded(id);
    this.setState((current) => {
      const locale = current.settings.general.locale;
      creation.current = createProjectConversationState({
        id,
        projectId,
        title: translate(locale, "newChat"),
        snippet: translate(locale, "defaultConversationSnippet"),
        time: nowLabel(),
        updatedAtMs: Date.now(),
        profile,
        state: current,
        thread,
      });
      return creation.current.state;
    });
    if (creation.current) {
      this.enqueueMutations(
        { type: "upsertConversation", conversation: creation.current.conversation, projectId, insertAtFront: true },
        { type: "upsertMessages", conversationId: id, messages: creation.current.thread },
        { type: "setSelectedConversation", conversationId: id },
      );
      this.persistCurrentStateNow();
    }
    return id;
  }

  setConversationProfile(id: string, profile: AgentProfile): void {
    const result: { current: ConversationMetadataStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = updateConversationProfileState(current, id, profile);
      return result.current?.state ?? current;
    });
    if (result.current) {
      this.enqueueMutations({ type: "setConversationProfile", conversationId: id, profile });
      this.persistCurrentStateNow();
    }
  }

  rename(id: string, title: string): void {
    this.patchConversationMetadata((current) => renameConversationState(current, id, title));
  }

  togglePin(id: string): void {
    this.patchConversationMetadata((current) => toggleConversationPinState(current, id));
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
    const result: { current: ArchiveConversationStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = archiveConversationState(current, id);
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    if (!result.current?.selectedId) {
      this.enqueueMutations({ type: "setSelectedConversation", conversationId: "" });
    }
    this.persistCurrentStateNow();
  }

  remove(id: string): string {
    this.cancelActiveRun(id);
    this.pendingQueues.delete(id);
    this.threadLoader.forget(id);
    let nextSelectedId = this.state.selectedId;
    this.setState((current) => {
      const result = removeConversationState(current, id);
      nextSelectedId = result.selectedId;
      return result.state;
    });
    this.enqueueMutations({ type: "deleteConversation", conversationId: id }, { type: "setSelectedConversation", conversationId: nextSelectedId });
    this.persistCurrentStateNow();
    if (nextSelectedId) {
      void this.loadThread(nextSelectedId);
    }
    return nextSelectedId;
  }

  sendMessage(id: string, text: string): void {
    // If the agent is still working, queue this turn on the server. The client
    // only mirrors the server snapshot; dispatching queued turns is owned by the
    // server so reloads, multiple tabs, and late run-finish events cannot start
    // duplicate agent runs from stale client state.
    if (this.conversationHasActiveWork(id)) {
      void enqueuePendingTurn(id, text)
        .then((snapshot) => {
          runInAction(() => this.setQueueSnapshot(snapshot));
        })
        .catch((error: unknown) => {
          runInAction(() => {
            this.loadError = error instanceof Error ? error.message : String(error);
          });
        });
      return;
    }
    const userMsg: ChatMessage = { id: nextWorkspaceId("u"), role: "user", text, time: nowLabel() };
    this.dispatchUserTurn(id, userMsg);
  }

  /** Append a user turn to the thread and start its run. Shared by immediate
   *  sends and by draining the pending queue, so a queued turn enters the thread
   *  exactly when it dispatches — never before. */
  private dispatchUserTurn(id: string, userMsg: ChatMessage): void {
    const result: { current: AppendUserMessageStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = appendUserMessageTurnState(current, id, userMsg);
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: userMsg });
    this.runTurn(id, userMsg);
  }

  pendingMessageCount(id: string): number {
    return this.queueSnapshot(id).messages.length;
  }

  /** Queued (not-yet-dispatched) user turns for a conversation, in send order. */
  queuedMessages(id: string): readonly ChatMessage[] {
    return this.queueSnapshot(id).messages;
  }

  /** Cancel a queued turn before it runs. */
  cancelQueuedMessage(id: string, messageId: string): void {
    void cancelPendingTurn(id, messageId)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  sendQueuedMessageNow(id: string): boolean {
    if (this.pendingMessageCount(id) === 0) {
      return false;
    }
    void sendNextPendingTurn(id)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
        void this.refreshBackgroundRuns();
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
    return true;
  }

  /** Whether the conversation's queue is paused (drains held until resumed). */
  isQueuePaused(id: string): boolean {
    return this.queueSnapshot(id).paused;
  }

  /** Pause/resume the server-owned queue. Resuming asks the server to drain; the
   *  client never dispatches queued turns itself. */
  setQueuePaused(id: string, paused: boolean): void {
    void setServerPendingTurnQueuePaused(id, paused)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
        if (!paused) {
          void this.refreshBackgroundRuns();
        }
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  /** Update this conversation's compaction preferences (auto on/off + window
   *  override). Stores only non-default values to keep persisted state tidy. */
  setCompaction(id: string, patch: Partial<CompactionSettings>): void {
    this.setState((current) => patchConversationCompactionState(current, id, patch));
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
      id: nextWorkspaceId("u"),
      role: "user",
      text: translate(this.state.settings.general.locale, "compactionRequested"),
      time: nowLabel(),
    };
    this.setState((current) => appendCompactionRequestState(current, id, userMsg));
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
    const message: ChatMessage = { id: nextWorkspaceId("u"), role: "user", time: nowLabel(), blocks: [{ kind: "review", comments: [...comments] }] };
    this.setState((current) => appendThreadMessageState(current, id, message));
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message });
    this.persistCurrentStateNow();
  }

  /** Run (or re-run) the agent for an existing user message in the thread.
   *  `promptOverride` sends a different prompt to the agent than the message text
   *  shows (used by manual compaction, where the bubble reads "Compact context"
   *  but the agent receives its `/compact` command). */
  private runTurn(id: string, userMsg: ChatMessage, options?: { readonly promptOverride?: string; readonly initialContextTokens?: number }): void {
    const conv = this.find(id);
    const runId = nextWorkspaceId("run");
    const aId = nextWorkspaceId("a");
    const agentTime = nowLabel();
    const agentStartedAtMs = Date.now();
    const preparedRun = prepareWorkspaceRunTurn({
      conversation: conv,
      thread: this.state.threads[id] ?? [],
      userMessage: userMsg,
      runId,
      agentMessageId: aId,
      agentMessageTime: agentTime,
      agentStartedAtMs,
      options,
    });
    const { agentMessage, conversationPatch, profile, prompt, resume } = preparedRun;

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

    this.setState((current) => patchConversation(current, id, conversationPatch));
    const runningConversation = this.find(id);
    if (runningConversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: runningConversation });
    }
    this.persistCurrentStateNow();

    // Create the agent message up-front (empty) so the thread shows a single
    // continuous "thinking" bubble that streams content in place — no separate
    // typing placeholder that pops out and gets replaced (which read as a flicker).
    this.setState((current) => {
      const arr = current.threads[id] ?? [];
      if (arr.some((m) => m.id === aId)) {
        return current;
      }
      return { ...current, threads: { ...current.threads, [id]: upsertAgentMessageForUserTurn(arr, userMsg.id, agentMessage) } };
    });
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: agentMessage });
    const applyBlocks = (blocks: AgentBlock[]) => {
      let blockUpdateMessage: ChatMessage | null = null;
      let blockUpdateShouldFlush = false;
      let blockUpdateShouldPersistBlocks = true;
      this.setState((current) => {
        const update = applyWorkspaceAgentBlocks({
          agentMessage,
          blocks,
          canceled: runHandle.canceled,
          conversationId: id,
          serverOwned: runHandle.serverOwned,
          state: current,
          userMessageId: userMsg.id,
        });
        blockUpdateMessage = update.message;
        blockUpdateShouldFlush = update.shouldFlush;
        blockUpdateShouldPersistBlocks = update.shouldPersistBlocks;
        return update.state;
      });
      if (blockUpdateShouldPersistBlocks) {
        if (blockUpdateMessage) {
          this.enqueueMutations({ type: "upsertMessage", conversationId: id, message: blockUpdateMessage });
        }
        const conversation = this.find(id);
        if (conversation && (blockUpdateShouldFlush || conversation.status === "waiting")) {
          this.enqueueMutations({ type: "updateConversation", conversation });
        }
      }
      if (blockUpdateShouldFlush) {
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
          // Mark the result unread when the user isn't looking at this conversation,
          // so the sidebar can flag a finished-but-unviewed turn. Opening the
          // conversation clears it (see setSelectedConversation).
          const unreadPatch = current.selectedId === id ? {} : { unread: true };
          const withConversation = patchConversation(settled, id, { ...finalRunPatch(settled, id, aId, result), ...unreadPatch });
          return patchAgentMessageUsage(withConversation, id, aId, result);
        });
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
            const unreadPatch = current.selectedId === id ? {} : { unread: true };
            return patchConversation(settled, id, { activeRunId: undefined, status: "error", ...(snippet ? { snippet } : {}), ...unreadPatch });
          });
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
        this.refreshQueue(id);
      });
  }

  stopRun(id: string): void {
    // Stopping the run also pauses the server-owned queue (only meaningful when
    // something is queued) so a pending turn doesn't immediately start after the
    // user explicitly hit stop.
    if (this.pendingMessageCount(id) > 0) {
      this.setQueuePaused(id, true);
    }
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
    const result: { current: StopRunConversationStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = stopRunConversationState(current, id, nowLabel());
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: result.current?.thread ?? [] });
    this.persistCurrentStateNow();
  }

  retryMessage(id: string, messageId: string): void {
    const thread = this.state.threads[id] ?? [];
    const selection = retryUserTurn(thread, messageId);
    if (!selection) {
      return;
    }
    const result: { current: UserTurnSelectionStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = applyUserTurnSelectionState(current, id, selection);
      return result.current.state;
    });
    const applied = result.current;
    if (!applied) {
      throw new Error(`Failed to apply retry turn selection for conversation ${id}.`);
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: applied.thread });
    this.runTurn(id, applied.userMsg);
  }

  forkConversationFromMessage(id: string, messageId: string): string | null {
    const forkResult: { current: ForkConversationStateResult | null } = { current: null };
    this.setState((current) => {
      const source = findConversation(current, id);
      if (!source) {
        return current;
      }

      const forkId = nextWorkspaceId("chat");
      const locale = current.settings.general.locale;
      forkResult.current = forkConversationState({
        conversationId: id,
        forkId,
        forkTitle: truncate(translate(locale, "forkedConversationTitle", { title: source.title }), 80),
        messageId,
        nextId: nextWorkspaceId,
        state: current,
        time: nowLabel(),
        updatedAtMs: Date.now(),
      });
      return forkResult.current?.state ?? current;
    });
    if (forkResult.current) {
      this.threadLoader.markLoaded(forkResult.current.forkId);
      this.enqueueMutations(
        { type: "upsertConversation", conversation: forkResult.current.conversation, projectId: forkResult.current.projectId, insertAtFront: true },
        { type: "upsertMessages", conversationId: forkResult.current.forkId, messages: forkResult.current.thread },
        { type: "setSelectedConversation", conversationId: forkResult.current.forkId },
      );
      this.persistCurrentStateNow();
    }
    return forkResult.current?.forkId ?? null;
  }

  editAndResendMessage(id: string, messageId: string, text: string): void {
    const thread = this.state.threads[id] ?? [];
    const selection = editUserTurn(thread, messageId, text, nowLabel());
    if (!selection) {
      return;
    }
    const result: { current: UserTurnSelectionStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = applyUserTurnSelectionState(current, id, selection);
      return result.current.state;
    });
    const applied = result.current;
    if (!applied) {
      throw new Error(`Failed to apply edited turn selection for conversation ${id}.`);
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: applied.thread });
    this.runTurn(id, applied.userMsg);
  }

  decideApproval(id: string, approvalId: string, decision: ApprovalDecision): void {
    const result: { current: AgentInputResponseStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = decideApprovalState(current, id, approvalId, decision, nowLabel());
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: result.current?.thread ?? [] });
    this.persistCurrentStateNow();
  }

  selectOptions(id: string, optionBlockId: string, selectedLabels: readonly string[]): void {
    const result: { current: AgentInputResponseStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = selectOptionsState(current, id, optionBlockId, selectedLabels, nowLabel());
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    this.enqueueMutations({ type: "replaceConversationThread", conversationId: id, messages: result.current?.thread ?? [] });
    this.persistCurrentStateNow();
  }

  updateComposerDraft(id: string, draft: ComposerDraft): void {
    this.setState((current) => putComposerDraftState(current, id, draft));
    const nextDraft = this.state.composerDrafts[id] ?? { text: "", attachments: [] };
    this.enqueueMutations(composerDraftMutation(id, nextDraft));
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

  private patchConversationMetadata(updater: (current: WorkspaceState) => ConversationMetadataStateResult | null): void {
    const result: { current: ConversationMetadataStateResult | null } = { current: null };
    this.setState((current) => {
      result.current = updater(current);
      return result.current?.state ?? current;
    });
    if (result.current) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
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
