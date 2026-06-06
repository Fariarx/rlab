import { type IReactionDisposer, makeAutoObservable, reaction, runInAction } from "mobx";
import { useEffect, useState } from "react";
import { type AgentBlock, type AgentProfile, type ApprovalDecision, type ChatMessage, type ComposerDraft, type ConversationStatus, type ConversationSummary, type Project } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { cancelRun, runConversation, type RunConversationResult } from "./run-agent";
import { nowLabel, starterThread, truncate } from "./sample-data";
import { type AppSettings, type AppSettingsPatch, type Locale, mergeAppSettings } from "./app-settings";
import { buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./workspace-state";

let idSeq = 1000;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

interface RunHandle {
  readonly controller: AbortController;
  readonly runId: string;
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

export function conversationProfile(conversation: ConversationSummary | null | undefined): AgentProfile {
  return conversation?.profile ?? { agent: conversation?.agent ?? "claude-code", variant: "DEFAULT" };
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

function snippetFromBlocks(blocks: readonly AgentBlock[] | undefined, locale: Locale): string {
  const textBlock = [...(blocks ?? [])].reverse().find((block) => block.kind === "text" && block.text.trim().length > 0);
  const snippetSource = textBlock?.kind === "text" ? textBlock.text : translate(locale, "runDoneSnippet");
  return truncate(snippetSource.replace(/\s+/g, " "), 60);
}

function finalRunPatch(
  current: WorkspaceState,
  conversationId: string,
  agentMessageId: string,
  result: RunConversationResult,
): Partial<ConversationSummary> {
  const locale = current.settings.general.locale;
  const agentBlocks = current.threads[conversationId]?.find((message) => message.id === agentMessageId)?.blocks;
  const inputResolved = agentBlocks !== undefined && !blocksNeedInput(agentBlocks);
  const resolvedStatus = result.status === "waiting" && inputResolved ? "done" : result.status;
  const resolvedSnippet = result.status === "waiting" && resolvedStatus === "done" ? snippetFromBlocks(agentBlocks, locale) : result.snippet;
  return {
    status: resolvedStatus,
    snippet: resolvedSnippet,
    ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function projectIdFromName(name: string): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Project name must contain letters or numbers.");
  }
  return id;
}

function userMessageText(state: WorkspaceState, conversationId: string, messageId: string): string | null {
  const message = state.threads[conversationId]?.find((item) => item.id === messageId);
  if (message?.role !== "user") {
    return null;
  }
  const text = message.text?.trim();
  return text ? text : null;
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
  readonly remove: (id: string) => void;
  readonly sendMessage: (id: string, text: string) => void;
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

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private readonly runs = new Map<string, RunHandle>();

  constructor() {
    makeAutoObservable<WorkspaceStore, "hydrated" | "loadSeq" | "runs" | "saveDisposer" | "pollTimer">(
      this,
      {
        hydrated: false,
        loadSeq: false,
        runs: false,
        saveDisposer: false,
        pollTimer: false,
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

  mount(): void {
    if (!this.saveDisposer) {
      this.saveDisposer = reaction(
        () => this.state,
        (state) => {
          if (!this.hydrated) {
            return;
          }
          void saveWorkspaceState(state).catch((error) => {
            runInAction(() => {
              this.loadError = error instanceof Error ? error.message : String(error);
            });
          });
        },
      );
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.hydrated && !this.loading && this.hasPersistedActiveRuns()) {
          this.reloadWorkspace();
        }
      }, 2000);
    }
    this.reloadWorkspace();
  }

  unmount(): void {
    this.loadSeq += 1;
    this.saveDisposer?.();
    this.saveDisposer = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
          this.state = cloneWorkspaceState(loadedState);
          this.loadError = null;
          this.loaded = true;
          this.hydrated = true;
        });
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
      (conversation) => conversation.status === "running" || conversation.status === "waiting",
    );
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
    const conv = this.find(id);
    const profile = conversationProfile(conv);
    const isDefaultTitle = isDefaultConversationTitle(conv?.title);
    const userMsg: ChatMessage = { id: nextId("u"), role: "user", text, time: nowLabel() };
    const runId = nextId("run");

    const runningPatch: Partial<ConversationSummary> = {
      status: "running" as ConversationStatus,
      snippet: truncate(text, 60),
      time: nowLabel(),
      unread: false,
      costUsd: undefined,
      usage: undefined,
    };
    const conversationPatch = isDefaultTitle ? { ...runningPatch, title: truncate(text, 40) } : runningPatch;
    this.setState((current) =>
      patchConversation(
        {
          ...current,
          threads: { ...current.threads, [id]: [...(current.threads[id] ?? []), userMsg] },
        },
        id,
        conversationPatch,
      ),
    );

    const aId = nextId("a");
    const agentTime = nowLabel();
    const applyBlocks = (blocks: AgentBlock[]) => {
      this.setState((current) => {
        const arr = current.threads[id] ?? [];
        const previousBlocks = arr.find((m) => m.id === aId)?.blocks;
        const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
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
        return blocksNeedInput(mergedBlocks)
          ? patchConversation(nextState, id, { status: "waiting", snippet: translate(current.settings.general.locale, "runNeedsInputSnippet"), time: nowLabel() })
          : nextState;
      });
    };

    const previous = this.runs.get(id);
    if (previous) {
      previous.canceled = true;
      void cancelRun(previous.runId).catch(() => undefined);
      previous.controller.abort();
    }
    const controller = new AbortController();
    const runHandle: RunHandle = { controller, runId, canceled: false };
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
      onBlocks: applyBlocks,
    })
      .then((result) => {
        if (!runHandle.canceled) {
          this.setState((current) => patchConversation(current, id, finalRunPatch(current, id, aId, result)));
        }
      })
      .catch(() => {
        if (!runHandle.canceled) {
          this.setState((current) => patchConversation(current, id, { status: "error", snippet: translate(current.settings.general.locale, "runFailedSnippet") }));
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
        status: "idle",
        snippet: translate(current.settings.general.locale, "runCanceledSnippet"),
        time: nowLabel(),
      });
    });
  }

  retryMessage(id: string, messageId: string): void {
    const text = userMessageText(this.state, id, messageId);
    if (text) {
      this.sendMessage(id, text);
    }
  }

  editAndResendMessage(id: string, messageId: string, text: string): void {
    if (!userMessageText(this.state, id, messageId)) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed) {
      this.sendMessage(id, trimmed);
    }
  }

  decideApproval(id: string, approvalId: string, decision: ApprovalDecision): void {
    this.setState((current) => patchConversation(patchApprovalDecision(current, id, approvalId, decision), id, { status: "running", time: nowLabel() }));
  }

  selectOptions(id: string, optionBlockId: string, selectedLabels: readonly string[]): void {
    this.setState((current) => patchConversation(patchOptionSelection(current, id, optionBlockId, selectedLabels), id, { status: "running", time: nowLabel() }));
  }

  updateComposerDraft(id: string, draft: ComposerDraft): void {
    this.setState((current) => ({
      ...current,
      composerDrafts: {
        ...current.composerDrafts,
        [id]: {
          text: draft.text,
          attachments: draft.attachments.map((attachment) => ({ ...attachment })),
        },
      },
    }));
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
