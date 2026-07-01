import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { accessModeForAgentProfile, compactCommandForAgent, type AgentBlock, type AgentProfile, type ApprovalDecision, type ChatMessage, type CompactionSettings, type ComposerDraft, type ConversationSummary, type ConversationView, type Project, type ReviewCommentEntry } from "../agent";
import { parseUserDraft } from "../agent/message/message-content-model";
import { translate } from "../../i18n/I18nProvider";
import { cancelRun, loadActiveRuns, runConversation, type ActiveRunSnapshot } from "../../client/api/run-agent";
import {
  cancelPendingQueueItem,
  cancelPendingTurn,
  enqueuePendingGoal,
  enqueuePendingTurn,
  loadPendingTurnQueue,
  movePendingQueueItemAfter,
  sendNextPendingTurn,
  setPendingTurnQueuePaused as setServerPendingTurnQueuePaused,
  type PendingQueueItem,
  type PendingQueuePauseReason,
  type PendingTurnQueueSnapshot,
} from "../../client/api/workspace-page-api";
import { loadConversationThread, loadConversationThreadPage, loadWorkspaceRevision, loadWorkspaceState, subscribeWorkspaceEvents, type WorkspaceChangeEvent } from "../../client/api/workspace-api";
import { reviewCommentsPromptText } from "../../lib/agent-prompt";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, mergeAppSettings } from "../../lib/app-settings";
import { runEventIsErrorSignal, runEventWritesAgentMessage, type RunEvent } from "../../lib/run-event-accumulator";
import type { WorkspaceMutation } from "../../lib/workspace-mutations";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "../../lib/workspace-state";
import { nextWorkspaceId, syncGeneratedWorkspaceIdSequence } from "../../lib/workspace-ids";
import {
  finalRunPatch,
  finishThreadLiveBlocks,
  isLiveRunStatus,
  isSettledRunConversationResult,
  patchActiveRunUpdate,
  patchActiveRunBoundUserMessage,
  patchAgentMessageUsage,
  settleThreadLiveBlocks,
  snippetFromStateThread,
  upsertAgentMessageForUserTurn,
} from "./models/workspace-run-state";
import {
  archiveConversationState,
  type ArchiveConversationStateResult,
  buildForkConversationTitle,
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
  reorderPinnedConversationsState,
  stopRunConversationState,
  type StopRunConversationStateResult,
  toggleConversationPinState,
  updateConversationProfileState,
} from "./models/workspace-conversation-model";
import { hasUntrackedPersistedActiveRuns, mergeBackgroundRunState, trackedPersistedActiveRunsMissingOnServer } from "./models/workspace-background-runs-model";
import { attachWorkspaceBackgroundRun, type RunHandle } from "./runtime/workspace-background-run-attachment";
import { mergeLoadedThread, mergeRemoteWorkspaceShell, prependLoadedThreadPage, type RemoteWorkspaceShellMerge } from "./models/workspace-server-sync-model";
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
  workspaceStateStructuralEqual,
} from "./models/workspace-state-utils";
import { WorkspaceSaveQueue } from "./runtime/workspace-save-queue";
import { prepareWorkspaceRunTurn } from "./models/workspace-run-turn-model";
import { applyWorkspaceAgentBlocks } from "./models/workspace-agent-block-update-model";
export { buildAgentPrompt, conversationProfile } from "./models/workspace-state-utils";

const WORKSPACE_LOAD_RETRY_MS = 15_000;
const WORKSPACE_SYNC_POLL_MS = 2_000;
const WORKSPACE_HIDDEN_SYNC_POLL_MS = 30_000;
const WORKSPACE_FOREGROUND_SYNC_DEBOUNCE_MS = 250;
const WORKSPACE_TRANSIENT_SYNC_RETRY_MS = 1_500;
const WORKSPACE_TRANSIENT_SYNC_GRACE_MS = 6_000;
const ACTIVE_RUN_DISCOVERY_POLL_MS = 30_000;
const TRACKED_RUN_MISSING_ON_SERVER_RECONCILE_MS = 45_000;
const RUN_ERROR_IDLE_AUTO_STOP_MS = 10 * 60_000;

function workspaceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientWorkspaceClientError(error: unknown): boolean {
  return error instanceof Error && (error instanceof TypeError || error.name === "AbortError" || error.name === "NetworkError");
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

export interface Workspace {
  readonly activeRunIds: ReadonlySet<string>;
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
  readonly reorderPinnedConversations: (orderedIds: readonly string[]) => void;
  readonly archive: (id: string) => void;
  readonly remove: (id: string) => string;
  readonly sendMessage: (id: string, text: string, reviewComments?: readonly ReviewCommentEntry[]) => void;
  readonly sendMessageAsGoal: (id: string, text: string) => void;
  readonly deferMessageToQueue: (id: string, text: string) => void;
  readonly pendingMessageCount: (id: string) => number;
  readonly pendingQueueItemCount: (id: string) => number;
  readonly queuedMessages: (id: string) => readonly ChatMessage[];
  readonly queuedItems: (id: string) => readonly PendingQueueItem[];
  readonly cancelQueuedMessage: (id: string, messageId: string) => void;
  readonly cancelQueuedItem: (id: string, itemId: string) => void;
  readonly editQueuedMessage: (id: string, itemId: string, message: ChatMessage) => ComposerDraft;
  readonly sendQueuedMessageNow: (id: string) => boolean;
  readonly moveQueuedItemAfter: (id: string, itemId: string, afterItemId: string | null) => void;
  readonly hasOlderThreadMessages: (id: string) => boolean;
  readonly loadOlderThread: (id: string) => Promise<void>;
  readonly isQueuePaused: (id: string) => boolean;
  readonly queueResumeAtMs: (id: string) => number | undefined;
  readonly setQueuePaused: (id: string, paused: boolean, options?: { readonly resumeAtMs?: number; readonly reason?: PendingQueuePauseReason }) => void;
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

  private unsubscribeWorkspaceEvents: (() => void) | null = null;

  private foregroundSyncTimer: ReturnType<typeof setTimeout> | null = null;

  private transientWorkspaceSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private transientWorkspaceSyncFailureStartedAtMs: number | null = null;

  private transientWorkspaceSyncWarningLogged = false;

  private workspaceClientServerSyncLoadError: string | null = null;

  private lastHiddenPollAt = 0;

  private lastActiveRunDiscoveryAt = 0;

  private backgroundRunsRefreshInFlight = false;

  private readonly runs = new Map<string, RunHandle>();

  private readonly saveQueue = new WorkspaceSaveQueue({
    activeRuns: this.runs,
    applyRemoteMergedState: (state, merge) => {
      runInAction(() => this.applyRemoteMergedState(state, merge));
    },
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
      this.workspaceRevision = Math.max(this.workspaceRevision, revision);
    },
  });
  private readonly pendingQueues = observable.map<string, PendingTurnQueueSnapshot>();

  private readonly queueRefreshInFlight = new Set<string>();

  private readonly threadLoader = new WorkspaceThreadLoader({
    loadConversationThreadFull: loadConversationThread,
    loadConversationThreadPage: (id, before) => loadConversationThreadPage(id, { before }),
    onLoadedThread: (id, messages) => {
      runInAction(() => {
        this.state = mergeLoadedThread(this.state, id, messages);
      });
    },
    onLoadedOlderThread: (id, messages) => {
      runInAction(() => {
        this.state = prependLoadedThreadPage(this.state, id, messages);
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
      loadOlderThread: action.bound,
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
      reorderPinnedConversations: action.bound,
      archive: action.bound,
      remove: action.bound,
      sendMessage: action.bound,
      sendMessageAsGoal: action.bound,
      deferMessageToQueue: action.bound,
      cancelQueuedMessage: action.bound,
      editQueuedMessage: action.bound,
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

  get activeRunIds(): ReadonlySet<string> {
    return new Set([...this.runs.values()].map((run) => run.runId));
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

  private hasWorkspaceSaveInFlight(): boolean {
    return this.saveQueue.hasSaveInFlight();
  }

  private clearForegroundSyncTimer(): void {
    if (this.foregroundSyncTimer) {
      clearTimeout(this.foregroundSyncTimer);
      this.foregroundSyncTimer = null;
    }
  }

  private clearTransientWorkspaceSyncRetryTimer(): void {
    if (this.transientWorkspaceSyncRetryTimer) {
      clearTimeout(this.transientWorkspaceSyncRetryTimer);
      this.transientWorkspaceSyncRetryTimer = null;
    }
  }

  private clearWorkspaceClientServerSyncIssue(): void {
    this.transientWorkspaceSyncFailureStartedAtMs = null;
    this.transientWorkspaceSyncWarningLogged = false;
    if (this.workspaceClientServerSyncLoadError !== null && this.loadError === this.workspaceClientServerSyncLoadError) {
      this.loadError = null;
    }
    this.workspaceClientServerSyncLoadError = null;
  }

  private clearWorkspaceLoadIssue(): void {
    this.clearTransientWorkspaceSyncRetryTimer();
    this.transientWorkspaceSyncFailureStartedAtMs = null;
    this.transientWorkspaceSyncWarningLogged = false;
    this.workspaceClientServerSyncLoadError = null;
    this.loadError = null;
  }

  private scheduleTransientWorkspaceSyncRetry(): void {
    if (this.transientWorkspaceSyncRetryTimer) {
      return;
    }
    this.transientWorkspaceSyncRetryTimer = setTimeout(() => {
      this.transientWorkspaceSyncRetryTimer = null;
      this.runForegroundWorkspaceSync();
    }, WORKSPACE_TRANSIENT_SYNC_RETRY_MS);
  }

  private handleWorkspaceClientServerSyncError(error: unknown): void {
    if (this.loaded && isTransientWorkspaceClientError(error)) {
      const now = Date.now();
      if (this.transientWorkspaceSyncFailureStartedAtMs === null) {
        this.transientWorkspaceSyncFailureStartedAtMs = now;
      }
      if (!this.transientWorkspaceSyncWarningLogged) {
        console.warn("[rlab] Transient workspace sync failed; retrying.", error);
        this.transientWorkspaceSyncWarningLogged = true;
      }
      if (now - this.transientWorkspaceSyncFailureStartedAtMs < WORKSPACE_TRANSIENT_SYNC_GRACE_MS) {
        this.scheduleTransientWorkspaceSyncRetry();
        return;
      }
    }
    this.clearTransientWorkspaceSyncRetryTimer();
    const message = workspaceErrorMessage(error);
    this.workspaceClientServerSyncLoadError = message;
    this.loadError = message;
  }

  private reportWorkspaceClientServerSyncError(error: unknown): void {
    runInAction(() => this.handleWorkspaceClientServerSyncError(error));
  }

  private applyRemoteServerState(serverState: WorkspaceState, preferredSelectedId: string): RemoteWorkspaceShellMerge {
    const merge = mergeRemoteWorkspaceShell({ current: this.state, serverState, preferredSelectedId, activeRuns: this.runs });
    this.applyRemoteMergedState(merge.state, merge);
    return merge;
  }

  private applyRemoteMergedState(nextState: WorkspaceState, merge: RemoteWorkspaceShellMerge): void {
    syncGeneratedWorkspaceIdSequence(nextState);
    this.threadLoader.reconcileRemoteShell(merge);
    if (!workspaceStateStructuralEqual(this.state, nextState)) {
      this.state = nextState;
    }
  }

  /** Lazily fetch a conversation's full message thread (the GET shell omits all
   *  but the selected one). No-op once fully held; never triggers a save. */
  loadThread(id: string): Promise<void> {
    return this.threadLoader.loadThread(id);
  }

  loadOlderThread(id: string): Promise<void> {
    return this.threadLoader.loadOlderThread(id);
  }

  isThreadLoaded(id: string): boolean {
    return this.threadLoader.isLoaded(id);
  }

  hasOlderThreadMessages(id: string): boolean {
    return this.threadLoader.hasOlderMessages(id);
  }

  private loadThreadFromServer(id: string, force: boolean): Promise<void> {
    return this.threadLoader.loadThread(id, force);
  }

  private refreshStaleThreadsAfterRemoteMerge(merge: RemoteWorkspaceShellMerge, changedConversationIds: readonly string[] = []): void {
    const ids = new Set([merge.selectedId, ...changedConversationIds].filter((id): id is string => id.length > 0));
    for (const id of ids) {
      const shouldRefreshSelectedShellThread = id === merge.selectedId && !this.threadLoader.isLoaded(id);
      if ((shouldRefreshSelectedShellThread || this.threadLoader.isStale(id)) && (id === merge.selectedId || this.threadLoader.isLoaded(id))) {
        void this.loadThreadFromServer(id, false);
      }
    }
  }

  private async ensureFullThreadLoaded(id: string): Promise<boolean> {
    if (this.threadLoader.isFullyLoaded(id) && !this.threadLoader.isStale(id)) {
      return true;
    }
    await this.threadLoader.loadFullThread(id);
    return this.threadLoader.isFullyLoaded(id) && !this.threadLoader.isStale(id);
  }

  private enqueueThreadMessageUpserts(conversationId: string, messages: readonly ChatMessage[]): void {
    const agentMessages = messages.filter((message) => message.role !== "user");
    if (agentMessages.length > 0) {
      this.enqueueMutations({ type: "upsertMessages", conversationId, messages: agentMessages });
    }
  }

  private queueSnapshot(id: string): PendingTurnQueueSnapshot {
    return this.pendingQueues.get(id) ?? { conversationId: id, paused: false, messages: [], items: [] };
  }

  private setQueueSnapshot(snapshot: PendingTurnQueueSnapshot): void {
    this.pendingQueues.set(snapshot.conversationId, snapshot);
  }

  private queueInterruptionResumeAtMs(): number {
    return Date.now() + this.state.settings.general.queueInterruptionPauseMs;
  }

  private clearRunErrorIdleStopTimer(runHandle: RunHandle): void {
    if (runHandle.errorIdleStopTimer !== null) {
      clearTimeout(runHandle.errorIdleStopTimer);
      runHandle.errorIdleStopTimer = null;
    }
  }

  private scheduleRunErrorIdleStop(id: string, runHandle: RunHandle): void {
    this.clearRunErrorIdleStopTimer(runHandle);
    runHandle.errorIdleStopTimer = setTimeout(() => {
      runHandle.errorIdleStopTimer = null;
      if (this.runs.get(id) !== runHandle || runHandle.canceled) {
        return;
      }
      void this.stopRunWithQueuePolicy(id, { pauseQueue: true, resumeAtMs: this.queueInterruptionResumeAtMs() }).catch(() => undefined);
    }, RUN_ERROR_IDLE_AUTO_STOP_MS);
  }

  private handleRunEventForErrorIdleStop(id: string, runHandle: RunHandle, event: RunEvent): void {
    if (runEventIsErrorSignal(event)) {
      this.scheduleRunErrorIdleStop(id, runHandle);
      return;
    }
    if (runEventWritesAgentMessage(event)) {
      this.clearRunErrorIdleStopTimer(runHandle);
    }
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
          this.loadError = workspaceErrorMessage(error);
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

  private refreshSelectedQueueIfNeeded(): void {
    const id = this.state.selectedId;
    if (id && this.shouldRefreshQueue(id)) {
      this.refreshQueue(id);
    }
  }

  private conversationHasActiveWork(id: string): boolean {
    if (this.runs.has(id)) {
      return true;
    }
    const conversation = this.find(id);
    return Boolean(conversation?.activeRunId && isLiveRunStatus(conversation.status));
  }

  private shouldRefreshQueue(id: string): boolean {
    const snapshot = this.queueSnapshot(id);
    return snapshot.paused || snapshot.items.length > 0 || snapshot.messages.length > 0 || this.conversationHasActiveWork(id);
  }

  private shouldRefreshQueueAfterWorkspaceEvent(id: string, event?: WorkspaceChangeEvent): boolean {
    return Boolean(event?.conversationIds?.includes(id)) || this.shouldRefreshQueue(id);
  }

  private shouldRunWorkspacePollTick(): boolean {
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      return true;
    }
    const now = Date.now();
    if (now - this.lastHiddenPollAt < WORKSPACE_HIDDEN_SYNC_POLL_MS) {
      return false;
    }
    this.lastHiddenPollAt = now;
    return true;
  }

  private shouldRefreshBackgroundRunsFromPoll(): boolean {
    if (this.runs.size > 0 || hasUntrackedPersistedActiveRuns(this.state, this.runs)) {
      return true;
    }
    const now = Date.now();
    return now - this.lastActiveRunDiscoveryAt >= ACTIVE_RUN_DISCOVERY_POLL_MS;
  }

  private runForegroundWorkspaceSync(): void {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (!this.hydrated || this.loading) {
      return;
    }
    void this.refreshWorkspaceFromServer();
    void this.refreshBackgroundRuns();
    this.refreshSelectedQueueIfNeeded();
  }

  private scheduleForegroundWorkspaceSync(): void {
    if (this.foregroundSyncTimer) {
      return;
    }
    this.foregroundSyncTimer = setTimeout(() => {
      this.foregroundSyncTimer = null;
      this.runForegroundWorkspaceSync();
    }, WORKSPACE_FOREGROUND_SYNC_DEBOUNCE_MS);
  }

  private syncForegroundWorkspaceState(): void {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (!this.hydrated || this.loading) {
      return;
    }
    this.scheduleForegroundWorkspaceSync();
  }

  private readonly handleWindowFocus = (): void => {
    this.syncForegroundWorkspaceState();
  };

  private readonly handleWindowPageShow = (): void => {
    this.syncForegroundWorkspaceState();
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      this.syncForegroundWorkspaceState();
    }
  };

  private connectWorkspaceEvents(): void {
    if (this.unsubscribeWorkspaceEvents) {
      return;
    }
    this.unsubscribeWorkspaceEvents = subscribeWorkspaceEvents({
      onEvent: (event) => {
        if (!this.hydrated || event.revision <= this.workspaceRevision) {
          return;
        }
        void this.refreshWorkspaceFromServer(event);
      },
      onError: () => undefined,
    });
  }

  mount(): void {
    this.connectWorkspaceEvents();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.handleWindowFocus);
      window.addEventListener("pageshow", this.handleWindowPageShow);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.hydrated && !this.loading && this.shouldRunWorkspacePollTick()) {
          void this.refreshWorkspaceFromServer();
          if (this.shouldRefreshBackgroundRunsFromPoll()) {
            void this.refreshBackgroundRuns();
          }
          this.refreshSelectedQueueIfNeeded();
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
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.handleWindowFocus);
      window.removeEventListener("pageshow", this.handleWindowPageShow);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    for (const run of this.runs.values()) {
      run.canceled = true;
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
    this.clearForegroundSyncTimer();
    this.clearTransientWorkspaceSyncRetryTimer();
    this.unsubscribeWorkspaceEvents?.();
    this.unsubscribeWorkspaceEvents = null;
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
    this.clearWorkspaceLoadIssue();
    loadWorkspaceState()
      .then((loadedState) => {
        if (seq !== this.loadSeq) {
          return;
        }
        let selectedId = "";
        runInAction(() => {
          this.workspaceRevision = typeof loadedState.revision === "number" ? loadedState.revision : 0;
          this.applyServerState(cloneWorkspaceState(loadedState));
          this.clearWorkspaceLoadIssue();
          this.saveQueue.replayPersistedMutationsAfterServerLoad();
          selectedId = this.state.selectedId;
          this.loaded = true;
          this.hydrated = true;
        });
        if (selectedId) {
          void this.loadThreadFromServer(selectedId, false);
        }
        void this.refreshBackgroundRuns();
        this.refreshSelectedQueue();
      })
      .catch((error) => {
        if (seq !== this.loadSeq) {
          return;
        }
        runInAction(() => {
          this.loadError = workspaceErrorMessage(error);
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

  private async refreshWorkspaceFromServer(event?: WorkspaceChangeEvent): Promise<void> {
    if (this.syncInFlight || !this.hydrated || this.loading || this.hasWorkspaceSaveInFlight()) {
      return;
    }
    const seq = this.loadSeq;
    this.syncInFlight = true;
    try {
      const revision = event?.revision ?? (await loadWorkspaceRevision());
      if (seq !== this.loadSeq || this.hasWorkspaceSaveInFlight()) {
        return;
      }
      if (revision <= this.workspaceRevision) {
        runInAction(() => this.clearWorkspaceClientServerSyncIssue());
        return;
      }
      const loadedState = await loadWorkspaceState();
      if (seq !== this.loadSeq || this.hasWorkspaceSaveInFlight()) {
        return;
      }
      if (typeof loadedState.revision !== "number") {
        throw new Error("Workspace state response is missing revision.");
      }
      const loadedRevision = loadedState.revision;
      if (loadedRevision <= this.workspaceRevision) {
        runInAction(() => this.clearWorkspaceClientServerSyncIssue());
        return;
      }
      const merge = runInAction((): RemoteWorkspaceShellMerge => {
        const preferredSelectedId = this.state.selectedId;
        if (this.hasPendingWorkspaceWrites()) {
          const rebasedMerge = this.saveQueue.rebasePendingMutationsAfterRemoteShell(cloneWorkspaceState(loadedState), loadedRevision);
          this.clearWorkspaceClientServerSyncIssue();
          return rebasedMerge;
        }
        this.workspaceRevision = loadedRevision;
        const remoteMerge = this.applyRemoteServerState(cloneWorkspaceState(loadedState), preferredSelectedId);
        this.clearWorkspaceClientServerSyncIssue();
        return remoteMerge;
      });
      const selectedId = merge.selectedId;
      if (selectedId) {
        this.refreshStaleThreadsAfterRemoteMerge(merge, event?.conversationIds);
        if (this.shouldRefreshQueueAfterWorkspaceEvent(selectedId, event)) {
          this.refreshQueue(selectedId);
        }
      }
      if (this.shouldRefreshBackgroundRunsFromPoll()) {
        void this.refreshBackgroundRuns();
      }
    } catch (error) {
      if (seq !== this.loadSeq) {
        return;
      }
      this.reportWorkspaceClientServerSyncError(error);
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
    if (this.backgroundRunsRefreshInFlight) {
      return;
    }
    this.backgroundRunsRefreshInFlight = true;
    this.lastActiveRunDiscoveryAt = Date.now();
    const seq = this.loadSeq;
    try {
      if (hasUntrackedPersistedActiveRuns(this.state, this.runs)) {
        await this.syncBackgroundRuns();
        return;
      }
      const active = await loadActiveRuns();
      if (seq !== this.loadSeq) {
        return;
      }
      const activeRunIds = new Set(active.map((run) => run.runId));
      const activeConversationIds = new Set(active.map((run) => run.conversationId));
      const missingTrackedConversationIds = trackedPersistedActiveRunsMissingOnServer(this.state, this.runs, activeRunIds, activeConversationIds)
        .filter((conversationId) => {
          const run = this.runs.get(conversationId);
          return Boolean(run && Date.now() - run.lastUpdateAtMs >= TRACKED_RUN_MISSING_ON_SERVER_RECONCILE_MS);
        });
      if (missingTrackedConversationIds.length > 0) {
        this.detachTrackedRuns(missingTrackedConversationIds);
        await this.syncBackgroundRuns();
        return;
      }
      if (active.some((run) => !this.runs.has(run.conversationId))) {
        await this.syncBackgroundRuns();
      }
    } catch (error) {
      if (seq === this.loadSeq && this.runs.size > 0) {
        runInAction(() => {
          this.loadError = workspaceErrorMessage(error);
        });
      }
    } finally {
      this.backgroundRunsRefreshInFlight = false;
    }
  }

  private detachTrackedRuns(conversationIds: readonly string[]): void {
    for (const conversationId of conversationIds) {
      const run = this.runs.get(conversationId);
      if (!run) {
        continue;
      }
      run.canceled = true;
      run.controller.abort();
      this.runs.delete(conversationId);
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
        const nextState = mergeBackgroundRunState({ current: this.state, loaded: loadedState, activeRunIds, trackedRuns: this.runs });
        syncGeneratedWorkspaceIdSequence(nextState);
        if (!workspaceStateStructuralEqual(this.state, nextState)) {
          this.state = nextState;
        }
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
        this.loadError = workspaceErrorMessage(error);
      });
    }
  }

  private attachBackgroundRun(run: ActiveRunSnapshot): void {
    if (run.userMessage) {
      runInAction(() => {
        this.state = patchActiveRunBoundUserMessage(this.state, run);
      });
    }
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

  reorderPinnedConversations(orderedIds: readonly string[]): void {
    const result: { current: ReturnType<typeof reorderPinnedConversationsState> | null } = { current: null };
    this.setState((current) => {
      result.current = reorderPinnedConversationsState(current, orderedIds);
      return result.current?.state ?? current;
    });
    if (result.current && result.current.conversations.length > 0) {
      this.enqueueMutations(...result.current.conversations.map((conversation) => ({ type: "updateConversation" as const, conversation })));
      this.persistCurrentStateNow();
    }
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

  sendMessage(id: string, text: string, reviewComments: readonly ReviewCommentEntry[] = []): void {
    if (!this.threadLoader.isLoaded(id)) {
      void this.loadThreadFromServer(id, false).then(() => {
        runInAction(() => {
          if (this.threadLoader.isLoaded(id)) {
            this.sendMessage(id, text, reviewComments);
          }
        });
      });
      return;
    }
    const reviewBlock = reviewComments.length > 0 ? { kind: "review" as const, comments: [...reviewComments] } : undefined;
    // If the agent is still working, queue this turn on the server. The server
    // owns queued-turn dispatch: enqueue never starts a run by itself, which keeps
    // a late queue request from racing ahead of the active /api/run registration.
    if (this.conversationHasActiveWork(id)) {
      const queuedText = reviewBlock ? [text.trim(), reviewCommentsPromptText(reviewComments)].filter(Boolean).join("\n\n") : text;
      void enqueuePendingTurn(id, queuedText)
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
    const userMsg: ChatMessage = { id: nextWorkspaceId("u"), role: "user", text, time: nowLabel(), createdAtMs: Date.now(), ...(reviewBlock ? { blocks: [reviewBlock] } : {}) };
    if (this.isQueuePaused(id) && this.pendingQueueItemCount(id) === 0) {
      this.setQueuePaused(id, false);
    }
    this.dispatchUserTurn(id, userMsg);
  }

  sendMessageAsGoal(id: string, text: string): void {
    const description = text.trim();
    if (!description) {
      return;
    }
    void enqueuePendingGoal(id, description)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  deferMessageToQueue(id: string, text: string): void {
    const queuedText = text.trim();
    if (!queuedText) {
      return;
    }
    void enqueuePendingTurn(id, queuedText, { pauseQueue: true })
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  /** Append a user turn to the thread and start its run. Immediate sends and
   *  explicit retry/edit flows use this path. Queued turns do not: they are
   *  appended by the server only when the queue drain claims them. */
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
    this.runTurn(id, userMsg, { serverPrompt: true });
  }

  pendingMessageCount(id: string): number {
    return this.queueSnapshot(id).messages.length;
  }

  pendingQueueItemCount(id: string): number {
    const snapshot = this.queueSnapshot(id);
    return snapshot.items.length > 0 ? snapshot.items.length : snapshot.messages.length;
  }

  /** Queued (not-yet-dispatched) user turns for a conversation, in send order. */
  queuedMessages(id: string): readonly ChatMessage[] {
    return this.queueSnapshot(id).messages;
  }

  queuedItems(id: string): readonly PendingQueueItem[] {
    const snapshot = this.queueSnapshot(id);
    return snapshot.items.length > 0
      ? snapshot.items
      : snapshot.messages.map((message, index) => ({
          id: message.id,
          conversationId: id,
          position: index,
          kind: "message" as const,
          createdAtMs: message.createdAtMs ?? 0,
          updatedAtMs: message.createdAtMs ?? 0,
          state: "queued" as const,
          message,
          origin: "",
        }));
  }

  private canSendQueuedItemNow(id: string): boolean {
    const items = this.queuedItems(id);
    if (items.some((item) => item.kind === "wakeup" && item.state === "waiting_wakeup")) {
      return false;
    }
    return items.some((item) => (item.kind === "message" || item.kind === "goal") && item.state === "queued");
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
    if (!this.canSendQueuedItemNow(id)) {
      return false;
    }
    const stopCurrentRun = this.conversationHasActiveWork(id) ? this.stopRunWithQueuePolicy(id, { pauseQueue: false }) : Promise.resolve();
    void stopCurrentRun
      .then(() => sendNextPendingTurn(id))
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

  cancelQueuedItem(id: string, itemId: string): void {
    void cancelPendingQueueItem(id, itemId)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  editQueuedMessage(id: string, itemId: string, message: ChatMessage): ComposerDraft {
    const draft = parseUserDraft(message.text ?? "");
    const snapshot = this.queueSnapshot(id);
    const hasServerItems = snapshot.items.length > 0;
    this.updateComposerDraft(id, draft);
    this.setQueueSnapshot({
      ...snapshot,
      messages: snapshot.messages.filter((queuedMessage) => queuedMessage.id !== message.id),
      items: snapshot.items.filter((item) => item.id !== itemId),
    });

    const cancelRequest = hasServerItems ? cancelPendingQueueItem(id, itemId) : cancelPendingTurn(id, message.id);
    void cancelRequest
      .then((nextSnapshot) => {
        runInAction(() => this.setQueueSnapshot(nextSnapshot));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
          this.refreshQueue(id);
        });
      });

    return draft;
  }

  moveQueuedItemAfter(id: string, itemId: string, afterItemId: string | null): void {
    void movePendingQueueItemAfter(id, itemId, afterItemId)
      .then((snapshot) => {
        runInAction(() => this.setQueueSnapshot(snapshot));
        void this.refreshBackgroundRuns();
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      });
  }

  /** Whether the conversation's queue is paused (drains held until resumed). */
  isQueuePaused(id: string): boolean {
    return this.queueSnapshot(id).paused;
  }

  /** Pause/resume the server-owned queue. Resuming asks the server to drain; the
   *  client never dispatches queued turns itself. */
  queueResumeAtMs(id: string): number | undefined {
    return this.queueSnapshot(id).resumeAtMs;
  }

  setQueuePaused(id: string, paused: boolean, options: { readonly resumeAtMs?: number; readonly reason?: PendingQueuePauseReason } = {}): void {
    void setServerPendingTurnQueuePaused(id, paused, options)
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
      createdAtMs: Date.now(),
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
    const message: ChatMessage = { id: nextWorkspaceId("u"), role: "user", time: nowLabel(), createdAtMs: Date.now(), blocks: [{ kind: "review", comments: [...comments] }] };
    this.setState((current) => appendThreadMessageState(current, id, message));
    this.enqueueMutations({ type: "upsertMessage", conversationId: id, message });
    this.persistCurrentStateNow();
  }

  /** Run (or re-run) the agent for an existing user message in the thread.
   *  `promptOverride` sends a different prompt to the agent than the message text
   *  shows (used by manual compaction, where the bubble reads "Compact context"
   *  but the agent receives its `/compact` command). */
  private runTurn(
    id: string,
    userMsg: ChatMessage,
    options?: { readonly promptOverride?: string; readonly initialContextTokens?: number; readonly serverPrompt?: boolean },
  ): void {
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
    const serverPrompt = options?.serverPrompt === true && options.promptOverride === undefined ? { userMessage: userMsg } : undefined;
    const promptForRequest = serverPrompt ? (userMsg.text ?? "") : prompt;

    // Cancel any run still in flight for this conversation BEFORE persisting the
    // (re-truncated) thread. Otherwise a server-owned background run can write the
    // old agent reply back into storage after our save, so it reappears on reload.
    const previous = this.runs.get(id);
    if (previous) {
      previous.canceled = true;
      this.clearRunErrorIdleStopTimer(previous);
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
      runHandle.lastUpdateAtMs = Date.now();
      let blockUpdateMessage: ChatMessage | null = null;
      let blockUpdateShouldFlush = false;
      let blockUpdateShouldPersistBlocks = true;
      runInAction(() => {
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
    const runHandle: RunHandle = { controller, runId, userMessageId: userMsg.id, agentMessageId: aId, lastUpdateAtMs: Date.now(), errorIdleStopTimer: null, serverOwned: false, canceled: false };
    this.runs.set(id, runHandle);

    runConversation({
      profile,
      prompt: promptForRequest,
      resume,
      compaction: conv?.compaction,
      cwd: this.cwdOf(id),
      accessMode: accessModeForAgentProfile(profile),
      locale: this.state.settings.general.locale,
      systemPrompt: this.state.settings.general.systemPrompt,
      binding: {
        conversationId: id,
        runId,
        userMessageId: userMsg.id,
        userMessageTime: userMsg.time ?? nowLabel(),
        userMessageCreatedAtMs: userMsg.createdAtMs ?? Date.now(),
        agentMessageId: aId,
        agentMessageTime: agentTime,
      },
      serverPrompt,
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
      onEvent: (event) => this.handleRunEventForErrorIdleStop(id, runHandle, event),
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
          if (serverPrompt) {
            this.enqueueMutations({ type: "restartUserTurn", conversationId: id, userMessage: serverPrompt.userMessage });
          }
          if (conversation) {
            this.enqueueMutations({ type: "updateConversation", conversation });
          }
          this.enqueueThreadMessageUpserts(id, this.state.threads[id] ?? []);
          this.persistCurrentStateNow();
        }
      })
      .finally(() => {
        this.clearRunErrorIdleStopTimer(runHandle);
        if (this.runs.get(id) === runHandle) {
          this.runs.delete(id);
        }
        this.refreshQueue(id);
      });
  }

  private stopRunWithQueuePolicy(id: string, options: { readonly pauseQueue: boolean; readonly resumeAtMs?: number }): Promise<void> {
    // Stopping the run also pauses the server-owned queue (only meaningful when
    // something is queued) so a pending turn doesn't immediately start after the
    // user explicitly hit stop.
    if (options.pauseQueue && (this.pendingQueueItemCount(id) > 0 || options.resumeAtMs !== undefined)) {
      this.setQueuePaused(id, true, { reason: "stop", resumeAtMs: options.resumeAtMs });
    }
    const active = this.runs.get(id);
    let cancelPromise: Promise<void> = Promise.resolve();
    if (active) {
      active.canceled = true;
      this.clearRunErrorIdleStopTimer(active);
      cancelPromise = cancelRun(active.runId, { pauseQueue: options.pauseQueue, pauseResumeAtMs: options.resumeAtMs });
      active.controller.abort();
      this.runs.delete(id);
    } else {
      const activeRunId = this.find(id)?.activeRunId;
      if (activeRunId) {
        cancelPromise = cancelRun(activeRunId, { pauseQueue: options.pauseQueue, pauseResumeAtMs: options.resumeAtMs });
      }
    }
    // Reset the conversation even when there is no live run handle (e.g. a
    // seeded "running" conversation, or one left "running" after a decision):
    // otherwise the stop button would hang with nothing to cancel.
    const result: { current: StopRunConversationStateResult | null } = { current: null };
    const canceledText = translate(this.state.settings.general.locale, "runCanceledSnippet");
    this.setState((current) => {
      result.current = stopRunConversationState(current, id, nowLabel(), canceledText);
      return result.current.state;
    });
    if (result.current?.conversation) {
      this.enqueueMutations({ type: "updateConversation", conversation: result.current.conversation });
    }
    this.enqueueThreadMessageUpserts(id, result.current?.thread ?? []);
    this.persistCurrentStateNow();
    return cancelPromise.finally(() => {
      this.refreshQueue(id);
    });
  }

  stopRun(id: string): void {
    void this.stopRunWithQueuePolicy(id, { pauseQueue: true }).catch(() => undefined);
  }

  retryMessage(id: string, messageId: string): void {
    if (!this.threadLoader.isFullyLoaded(id) || this.threadLoader.isStale(id)) {
      void this.ensureFullThreadLoaded(id).then((loaded) => {
        if (loaded) {
          this.retryMessage(id, messageId);
        }
      });
      return;
    }
    const thread = this.state.threads[id] ?? [];
    const selection = retryUserTurn(thread, messageId, nowLabel(), Date.now());
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
    this.runTurn(id, applied.userMsg, { serverPrompt: true });
  }

  forkConversationFromMessage(id: string, messageId: string): string | null {
    const forkResult: { current: ForkConversationStateResult | null } = { current: null };
    this.setState((current) => {
      const source = findConversation(current, id);
      if (!source) {
        return current;
      }

      const forkId = nextWorkspaceId("chat");
      forkResult.current = forkConversationState({
        conversationId: id,
        forkId,
        forkTitle: truncate(buildForkConversationTitle(source.title), 80),
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
    if (!this.threadLoader.isFullyLoaded(id) || this.threadLoader.isStale(id)) {
      void this.ensureFullThreadLoaded(id).then((loaded) => {
        if (loaded) {
          this.editAndResendMessage(id, messageId, text);
        }
      });
      return;
    }
    const thread = this.state.threads[id] ?? [];
    const selection = editUserTurn(thread, messageId, text, nowLabel(), Date.now());
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
    this.runTurn(id, applied.userMsg, { serverPrompt: true });
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
    this.enqueueThreadMessageUpserts(id, result.current?.thread ?? []);
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
    this.enqueueThreadMessageUpserts(id, result.current?.thread ?? []);
    this.persistCurrentStateNow();
  }

  updateComposerDraft(id: string, draft: ComposerDraft): void {
    const previousState = this.state;
    this.setState((current) => putComposerDraftState(current, id, draft));
    if (this.state === previousState) {
      return;
    }
    const nextDraft = this.state.composerDrafts[id] ?? { text: "", attachments: [] };
    const mutation = composerDraftMutation(id, nextDraft);
    this.enqueueMutations(mutation);
    if (mutation.type === "deleteComposerDraft") {
      this.persistCurrentStateNow();
    }
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
