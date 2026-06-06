import { type IReactionDisposer, makeAutoObservable, reaction, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { agentProfileEquals, normalizeAgentProfile, type AgentBlock, type AgentProfile, type ApprovalDecision, type ChatMessage, type ComposerDraft, type ConversationStatus, type ConversationSummary, type Project, type ReviewCommentEntry } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { attachRunUpdates, cancelRun, loadActiveRuns, runConversation, type ActiveRunSnapshot, type ActiveRunUpdate, type RunConversationResult } from "./run-agent";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, type Locale, mergeAppSettings } from "./app-settings";
import { buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./workspace-state";

const WORKSPACE_LOAD_RETRY_MS = 15_000;
const WORKSPACE_SAVE_DEBOUNCE_MS = 250;

let idSeq = 1000;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

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

async function loadWorkspaceState(): Promise<WorkspaceState> {
  const response = await fetch("/api/workspace", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Workspace load failed (${response.status})`);
  }
  return (await response.json()) as WorkspaceState;
}

async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`Workspace save failed (${response.status})`);
  }
}

function findConversation(state: WorkspaceState, id: string): ConversationSummary | null {
  return [...state.chats, ...state.projects.flatMap((p) => p.conversations)].find((c) => c.id === id) ?? null;
}

function workspaceConversations(state: WorkspaceState): ConversationSummary[] {
  return [...state.chats, ...state.projects.flatMap((project) => project.conversations)];
}

function serializableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function conversationProfile(conversation: ConversationSummary | null | undefined): AgentProfile {
  return normalizeAgentProfile(conversation?.profile, conversation?.agent ?? "claude-code");
}

function conversationCwd(state: WorkspaceState, id: string): string | undefined {
  return state.projects.find((p) => p.conversations.some((c) => c.id === id))?.path;
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

function isLiveRunStatus(status: ConversationStatus): boolean {
  return status === "running" || status === "waiting";
}

function patchActiveRunUpdate(state: WorkspaceState, update: ActiveRunUpdate): WorkspaceState {
  const messages = state.threads[update.conversationId] ?? [];
  const previousBlocks = messages.find((message) => message.id === update.agentMessageId)?.blocks;
  const blocks = mergeInputBlockState(update.blocks, previousBlocks);
  const message: ChatMessage = {
    id: update.agentMessageId,
    role: "agent",
    time: update.time,
    blocks,
    ...(update.costUsd === undefined ? {} : { costUsd: update.costUsd }),
    ...(update.usage === undefined ? {} : { usage: update.usage }),
  };
  const threads = {
    ...state.threads,
    [update.conversationId]: messages.some((item) => item.id === update.agentMessageId)
      ? messages.map((item) => (item.id === update.agentMessageId ? message : item))
      : [...messages, message],
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
  readonly remove: (id: string) => void;
  readonly sendMessage: (id: string, text: string) => void;
  readonly addReviewComments: (id: string, comments: readonly ReviewCommentEntry[]) => void;
  readonly stopRun: (id: string) => void;
  readonly retryMessage: (id: string, messageId: string) => void;
  readonly editAndResendMessage: (id: string, messageId: string, text: string) => void;
  readonly decideApproval: (id: string, approvalId: string, decision: ApprovalDecision) => void;
  readonly selectOptions: (id: string, optionBlockId: string, selectedLabels: readonly string[]) => void;
  readonly updateComposerDraft: (id: string, draft: ComposerDraft) => void;
  readonly updateSettings: (patch: AppSettingsPatch) => void;
  readonly reloadWorkspace: () => void;
  readonly find: (id: string) => ConversationSummary | null;
  readonly cwdOf: (id: string) => string | undefined;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly loadError: string | null;
}

class WorkspaceStore implements Workspace {
  state: WorkspaceState = buildInitialWorkspaceState();

  loadError: string | null = null;

  loaded = false;

  loading = true;

  private hydrated = false;

  private loadSeq = 0;

  private saveDisposer: IReactionDisposer | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingSaveState: WorkspaceState | null = null;

  private pendingSaveUrgent = false;

  private saveInFlight = false;

  private inFlightSaveState: WorkspaceState | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private loadRetryTimer: ReturnType<typeof setInterval> | null = null;

  private skipNextSave = false;

  private readonly runs = new Map<string, RunHandle>();

  constructor() {
    makeAutoObservable<
      WorkspaceStore,
      | "hydrated"
      | "loadSeq"
      | "runs"
      | "saveDisposer"
      | "saveTimer"
      | "pendingSaveState"
      | "pendingSaveUrgent"
      | "saveInFlight"
      | "inFlightSaveState"
      | "pollTimer"
      | "loadRetryTimer"
      | "skipNextSave"
    >(
      this,
      {
        hydrated: false,
        loadSeq: false,
        runs: false,
        saveDisposer: false,
        saveTimer: false,
        pendingSaveState: false,
        pendingSaveUrgent: false,
        saveInFlight: false,
        inFlightSaveState: false,
        pollTimer: false,
        loadRetryTimer: false,
        skipNextSave: false,
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
    if (this.state !== state) {
      this.skipNextSave = true;
      this.state = state;
    }
  }

  mount(): void {
    if (!this.saveDisposer) {
      this.saveDisposer = reaction(
        () => this.state,
        (state) => {
          if (!this.hydrated) {
            return;
          }
          if (this.skipNextSave) {
            this.skipNextSave = false;
            return;
          }
          this.scheduleSave(state);
        },
      );
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.hydrated && !this.loading && this.hasPersistedActiveRuns()) {
          void this.syncBackgroundRuns();
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
    this.saveDisposer?.();
    this.saveDisposer = null;
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

  private scheduleSave(state: WorkspaceState): void {
    if (this.pendingSaveState === state || (this.saveInFlight && this.inFlightSaveState === state)) {
      return;
    }
    this.pendingSaveState = state;
    this.startSaveTimer();
  }

  private persistCurrentStateNow(): void {
    this.pendingSaveState = this.state;
    this.pendingSaveUrgent = true;
    void this.flushPendingSave();
  }

  private async flushPendingSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveInFlight) {
      this.pendingSaveUrgent = true;
      return;
    }
    const state = this.pendingSaveState;
    if (!state) {
      return;
    }
    this.pendingSaveState = null;
    this.pendingSaveUrgent = false;
    this.saveInFlight = true;
    this.inFlightSaveState = state;
    try {
      await saveWorkspaceState(state);
    } catch (error) {
      runInAction(() => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
    } finally {
      runInAction(() => {
        this.saveInFlight = false;
        this.inFlightSaveState = null;
        if (this.pendingSaveState) {
          if (this.pendingSaveUrgent) {
            void this.flushPendingSave();
          } else {
            this.startSaveTimer();
          }
        }
      });
    }
  }

  reloadWorkspace(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
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
        if (this.hasPersistedActiveRuns()) {
          void this.syncBackgroundRuns();
        }
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
        throw new Error(`Workspace API returned stale active run ${currentConversation.activeRunId}.`);
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
    attachRunUpdates({
      runId: run.runId,
      signal: controller.signal,
      onUpdate: (update) => {
        if (this.runs.get(run.conversationId) !== runHandle) {
          return;
        }
        runInAction(() => {
          this.skipNextSave = true;
          this.state = patchActiveRunUpdate(this.state, update);
          this.loadError = null;
        });
      },
    })
      .catch((error) => {
        if (controller.signal.aborted || runHandle.canceled) {
          return;
        }
        runInAction(() => {
          this.loadError = error instanceof Error ? error.message : String(error);
        });
      })
      .finally(() => {
        if (this.runs.get(run.conversationId) === runHandle) {
          this.runs.delete(run.conversationId);
        }
      });
  }

  find(id: string): ConversationSummary | null {
    return findConversation(this.state, id);
  }

  cwdOf(id: string): string | undefined {
    return conversationCwd(this.state, id);
  }

  select(id: string): void {
    this.setState((current) => patchConversation({ ...current, selectedId: id }, id, { unread: false }));
  }

  newChat(profile: AgentProfile): string {
    const id = nextId("chat");
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
      return {
        ...current,
        chats: [conv, ...current.chats],
        threads: { ...current.threads, [id]: starterThread() },
        selectedId: id,
      };
    });
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
        threads: { ...current.threads, [conversationId]: starterThread() },
        selectedId: conversationId,
      };
    });
    return { projectId, conversationId };
  }

  newProjectChat(projectId: string, profile: AgentProfile): string {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} was not found.`);
    }
    const id = nextId("chat");
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
      return {
        ...current,
        projects: current.projects.map((item) => (item.id === projectId ? { ...item, conversations: [conv, ...item.conversations] } : item)),
        threads: { ...current.threads, [id]: starterThread() },
        selectedId: id,
      };
    });
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

  remove(id: string): void {
    const active = this.runs.get(id);
    if (active) {
      active.canceled = true;
      void cancelRun(active.runId).catch(() => undefined);
      active.controller.abort();
      this.runs.delete(id);
    }
    this.setState((current) => {
      const threads = { ...current.threads };
      const composerDrafts = { ...current.composerDrafts };
      delete threads[id];
      delete composerDrafts[id];
      return {
        ...current,
        chats: current.chats.filter((c) => c.id !== id),
        projects: current.projects.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.id !== id) })),
        threads,
        composerDrafts,
        selectedId: current.selectedId === id ? "" : current.selectedId,
      };
    });
  }

  sendMessage(id: string, text: string): void {
    const userMsg: ChatMessage = { id: nextId("u"), role: "user", text, time: nowLabel() };
    this.setState((current) => ({
      ...current,
      threads: { ...current.threads, [id]: [...(current.threads[id] ?? []), userMsg] },
    }));
    this.runTurn(id, userMsg);
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
  }

  /** Run (or re-run) the agent for an existing user message in the thread. */
  private runTurn(id: string, userMsg: ChatMessage): void {
    const conv = this.find(id);
    const profile = conversationProfile(conv);
    const isDefaultTitle = isDefaultConversationTitle(conv?.title);
    const text = userMsg.text ?? "";
    const runId = nextId("run");

    const runningPatch: Partial<ConversationSummary> = {
      activeRunId: runId,
      status: "running" as ConversationStatus,
      snippet: truncate(text, 60),
      time: nowLabel(),
      unread: false,
      costUsd: undefined,
      usage: undefined,
    };
    const conversationPatch = isDefaultTitle ? { ...runningPatch, title: truncate(text, 40) } : runningPatch;
    this.setState((current) => patchConversation(current, id, conversationPatch));
    this.persistCurrentStateNow();

    const aId = nextId("a");
    const agentTime = nowLabel();
    const applyBlocks = (blocks: AgentBlock[]) => {
      let shouldFlush = false;
      this.setState((current) => {
        const arr = current.threads[id] ?? [];
        const previousBlocks = arr.find((m) => m.id === aId)?.blocks;
        const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
        const needsInput = blocksNeedInput(mergedBlocks);
        if (runHandle.serverOwned && !needsInput && blocksHaveLiveOutput(mergedBlocks)) {
          this.skipNextSave = true;
        }
        shouldFlush = needsInput || blocksHaveStatus(mergedBlocks);
        const message: ChatMessage = { id: aId, role: "agent", time: agentTime, blocks: mergedBlocks };
        const nextState = {
          ...current,
          threads: {
            ...current.threads,
            [id]: arr.some((m) => m.id === aId) ? arr.map((m) => (m.id === aId ? message : m)) : [...arr, message],
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
      if (shouldFlush) {
        this.persistCurrentStateNow();
      }
    };

    const previous = this.runs.get(id);
    if (previous) {
      previous.canceled = true;
      void cancelRun(previous.runId).catch(() => undefined);
      previous.controller.abort();
    }
    const controller = new AbortController();
    const runHandle: RunHandle = { controller, runId, serverOwned: false, canceled: false };
    this.runs.set(id, runHandle);

    runConversation({
      profile,
      prompt: text,
      cwd: this.cwdOf(id),
      accessMode: this.state.settings.agents.accessMode,
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
      onBlocks: applyBlocks,
    })
      .then((result) => {
        if (runHandle.canceled || !isSettledRunConversationResult(result)) {
          return;
        }
        this.setState((current) => {
          const withConversation = patchConversation(current, id, finalRunPatch(current, id, aId, result));
          return patchAgentMessageUsage(withConversation, id, aId, result);
        });
        this.persistCurrentStateNow();
      })
      .catch(() => {
        if (!runHandle.canceled) {
          this.setState((current) => patchConversation(current, id, { activeRunId: undefined, status: "error", snippet: translate(current.settings.general.locale, "runFailedSnippet") }));
          this.persistCurrentStateNow();
        }
      })
      .finally(() => {
        if (this.runs.get(id) === runHandle) {
          this.runs.delete(id);
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
      const conversation = findConversation(current, id);
      if (!conversation || (conversation.status !== "running" && conversation.status !== "waiting")) {
        return current;
      }
      return patchConversation(current, id, {
        activeRunId: undefined,
        status: "idle",
        snippet: translate(current.settings.general.locale, "runCanceledSnippet"),
        time: nowLabel(),
      });
    });
    this.persistCurrentStateNow();
  }

  retryMessage(id: string, messageId: string): void {
    const thread = this.state.threads[id] ?? [];
    const index = thread.findIndex((message) => message.role === "user" && message.id === messageId);
    if (index < 0) {
      return;
    }
    const userMsg = thread[index];
    // Drop everything after this user message (the stale agent reply) and re-run
    // it in place — no duplicate user turn.
    this.setState((current) => ({ ...current, threads: { ...current.threads, [id]: thread.slice(0, index + 1) } }));
    this.runTurn(id, userMsg);
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
    // Replace the edited user message, drop everything after it, and re-run.
    const userMsg: ChatMessage = { ...thread[index], text: trimmed, time: nowLabel() };
    this.setState((current) => ({ ...current, threads: { ...current.threads, [id]: [...thread.slice(0, index), userMsg] } }));
    this.runTurn(id, userMsg);
  }

  decideApproval(id: string, approvalId: string, decision: ApprovalDecision): void {
    this.setState((current) => patchConversation(patchApprovalDecision(current, id, approvalId, decision), id, { status: "running", time: nowLabel() }));
    this.persistCurrentStateNow();
  }

  selectOptions(id: string, optionBlockId: string, selectedLabels: readonly string[]): void {
    this.setState((current) => patchConversation(patchOptionSelection(current, id, optionBlockId, selectedLabels), id, { status: "running", time: nowLabel() }));
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
  }

  updateSettings(patch: AppSettingsPatch): void {
    this.setState((current) => ({
      ...current,
      settings: mergeAppSettings(current.settings, patch),
    }));
  }

  private patchConv(id: string, patch: Partial<ConversationSummary>): void {
    this.setState((current) => patchConversation(current, id, patch));
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
